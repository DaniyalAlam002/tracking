(function () {
    // === CONFIG ===
    const API_ENDPOINT = "https://lenz.grayphite.com/api/visitor";
    const COOKIE_NAME = "lenz_visitor_id";
    const COOKIE_EXPIRY_DAYS = 365;
    const HEARTBEAT_INTERVAL_MS = 0.5 * 60 * 1000;
    const INACTIVITY_THRESHOLD_MS = 0.5 * 60 * 1000;

    let lastActivityTime = Date.now();
    let myPhone = "123456789";
    // Better regex: matches +, spaces, dashes, parentheses, and digits
    const phoneRegex = /(\+?\d[\d\s\-\(\)]{5,}\d)/g;
    // =========================
    // 🧠 Utility Functions
    // =========================

    /**
     * Generates a UUID v4 (RFC4122-compliant)
     * @returns {string}
     */
    function generateUUIDv4() {
        return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
            (
                c ^
                (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))
            ).toString(16)
        );
    }

    /**
     * Sets a first-party cookie
     * @param {string} name
     * @param {string} value
     * @param {number} daysToExpire
     */
    function setCookie(name, value, daysToExpire) {
        const date = new Date(Date.now() + daysToExpire * 864e5);
        document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(
            value
        )}; path=/; expires=${date.toUTCString()}; SameSite=Lax`;
    }

    /**
     * Gets a cookie by name
     * @param {string} name
     * @returns {string|null}
     */
    function getCookie(name) {
        return (
            document.cookie
                .split("; ")
                .find((row) => row.startsWith(encodeURIComponent(name) + "="))
                ?.split("=")[1] || null
        );
    }

    /**
     * Parses UTM parameters from URL
     * @returns {Record<string, string>}
     */
    function extractUTMParams() {
        const params = new URLSearchParams(window.location.search);
        const result = {};
        for (const [key, value] of params.entries()) {
            if (key.toLowerCase().startsWith("utm_")) {
                result[key] = value;
            }
        }
        return result;
    }

    // Replace phone numbers
    function replacePhones(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            if (phoneRegex.test(node.textContent)) {
                node.textContent = node.textContent.replace(phoneRegex, myPhone);
            }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            // Replace tel: links
            if (node.tagName === "A" && node.hasAttribute("href")) {
                let href = node.getAttribute("href");
                if (href.startsWith("tel:")) {
                    node.setAttribute("href", "tel:" + myPhone);
                    node.textContent = myPhone;
                }
            }
            // Recurse children (skip scripts/styles)
            if (node.tagName !== "SCRIPT" && node.tagName !== "STYLE") {
                for (let child of node.childNodes) {
                    replacePhones(child);
                }
            }
        }
    }

    // Extract company id from script src
    function extractCompanyIdFromScriptSrc() {
        const scripts = Array.from(document.getElementsByTagName('script'));
        const script = scripts.find(s => s.src.includes('/companies/') && s.src.endsWith('.js'));
        if (!script) return null;
        const match = script.src.match(/\/companies\/([a-f0-9\-]{36})\.js$/);
        return match ? match[1] : null;
    }

    const companyId = extractCompanyIdFromScriptSrc();

    let userIPPromise = fetch('https://api.ipify.org?format=json')
        .then(res => res.json())
        .then(data => data.ip)
        .catch(err => {
            console.error('Error fetching IP:', err);
            return ''; // fallback to empty
        });

    /**
     * Send captured form data to backend
     * @param {Object} data
     */
    async function sendToBackend(payloaad, endpoint, isHeartbeat = 0) {
        console.log("data", payloaad);
        const ip_address = await userIPPromise;
        const payloadToSend = {
            ...payloaad,
            session_id: visitorId,
            company_id: companyId,
            submitted_at: new Date().toISOString(),
            referrer: document.referrer || "direct",
            utmParams: extractUTMParams(),
            landing: window.location.href,
            pagePath: window.location.pathname + window.location.search,
            userAgent: navigator.userAgent,
            ip_address,
        };
        console.log("payload", payloadToSend);
        if (isHeartbeat == 1) {
            // phone number request
            try {
                const response = await fetch(API_ENDPOINT + endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(payloadToSend),
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const data = await response.json(); // or response.text() if not JSON
                myPhone = data.phone;
                replacePhones(document.body)
                console.log('API response:', data);

            } catch (err) {
                console.error('Form data send error:', err);
            }

        } else {
            try {
                const blob = new Blob([JSON.stringify(payloadToSend)], {
                    type: "application/json",
                });
                navigator.sendBeacon(API_ENDPOINT + endpoint, blob);
            } catch (err) {
                console.error("Form data send error:", err);
            }
        }
    }

    // Activity tracking
    function updateLastActivity() {
        lastActivityTime = Date.now();
    }

    // Setup activity listeners
    function setupActivityListeners() {
        const activityEvents = ['mousemove', 'scroll', 'keydown', 'click', 'touchstart'];
        activityEvents.forEach(event => {
            window.addEventListener(event, updateLastActivity, { passive: true });
        });
    }

    /**
     * Extract values from all input/textarea/select fields inside a container
     * @param {HTMLElement} container
     * @param {boolean} excludeForms - if true, skip fields inside forms
     */
    function collectFields(container, excludeForms = false) {
        const fields = container.querySelectorAll("input, textarea, select");
        const data = {};
        let counter = 0; // for unique keys for unnamed inputs

        fields.forEach((field) => {
            if (excludeForms && field.closest("form")) return; // skip fields inside forms

            // Determine key: name > id > type + counter
            let key = field.name || field.id;
            if (!key) {
                key = field.type + "_" + counter; // make unique
                counter++;
            }

            if (/cardnum|credit|cvc|password/i.test(key)) return;

            switch (field.type) {
                case "checkbox":
                    if (!data[key]) data[key] = [];
                    if (field.checked) data[key].push(field.value || true);
                    break;
                case "radio":
                    if (field.checked) data[key] = field.value;
                    break;
                case "file":
                    const files = Array.from(field.files || []);
                    data[key] = files.map(f => f.name);
                    break;
                case "select-multiple":
                    data[key] = Array.from(field.selectedOptions).map(o => o.value);
                    break;
                default:
                    data[key] = field.value;
            }
        });

        return data;
    }



    /**
     * Attach listeners to traditional forms
     */
    function hookForms() {
        document.querySelectorAll("form").forEach((form) => {
            form.addEventListener("submit", function (e) {
                e.preventDefault(); // prevent page reload
                try {
                    const data = collectFields(form);
                    data._page = window.location.href;
                    data._event = "form_submit";

                    console.log("dswe");
                    sendToBackend(data, '/submit_form');
                } catch (err) {
                    console.error("Error collecting form:", err);
                }
            });
        });
    }

    /**
     * Attach listeners to non-form buttons (div, button[type=button], etc.)
     */
    function hookButtons() {
        document
            .querySelectorAll("button, [role=button], input[type=button]")
            .forEach((btn) => {
                if (btn.type === "submit") return;
                btn.addEventListener("click", function () {
                    try {
                        // Look upwards for nearest parent form-like container
                        const container = btn.closest("form") || document.body;
                        console.log("container", container);
                        const data = collectFields(container, true);
                        data._page = window.location.href;
                        data._event = "button_click";
                        sendToBackend(data, '/submit_form');
                    } catch (err) {
                        console.error("Error collecting button click:", err);
                    }
                });
            });
    }
    
    // === Manual hook for SPAs / dynamic forms ===
    window.captureForm = function (nodeOrSelector, callback) {
        const form =
            typeof nodeOrSelector === "string"
                ? document.querySelector(nodeOrSelector)
                : nodeOrSelector;
        if (!form || form.dataset.crNoCapture) return;
        form.addEventListener("submit", function (e) {
            e.preventDefault();
            try {
                const data = collectFields(form);
                data._page = window.location.href;
                data._event = "form_submit";
                if (callback) callback(data);
                sendToBackend(data, '/submit_form');
            } catch (err) {
                console.error("Error capturing form:", err);
            }
        });
    };

    // === MutationObserver for dynamically added forms ===
    new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.tagName === "FORM" && !node.dataset.crNoCapture) {
                    window.captureForm(node);
                }
            });
        });
    }).observe(document.body, { childList: true, subtree: true });
    // Initialize once DOM is ready
    const isNewVisitor = !getCookie(COOKIE_NAME);
    const visitorId = isNewVisitor
        ? generateUUIDv4()
        : getCookie(COOKIE_NAME);

    if (isNewVisitor) {
        setCookie(COOKIE_NAME, visitorId, COOKIE_EXPIRY_DAYS);
        console.info("[VisitorTracker] New visitor ID set:", visitorId);
    } else {
        console.info("[VisitorTracker] Returning visitor:", visitorId);
    }

    // Run on load          
    function onDOMReady(callback) {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", callback);
        } else {
            callback();
        }
    }

    onDOMReady(() => {
        // Hook forms and buttons
        hookForms();
        hookButtons();

        // Initialize visitor session and phone request
        console.debug('[VisitorTracker] Session Info:');
        sendToBackend({}, '/create_session');
        sendToBackend({}, '/request_phone_number', 2);

        // Setup user activity tracking
        setupActivityListeners();

        // Replace phone numbers in the page
        replacePhones(document.body);
    });


    setInterval(() => {
        const now = Date.now();
        const inactiveFor = now - lastActivityTime;
        console.log("inactiveFor", inactiveFor);

        if (inactiveFor < INACTIVITY_THRESHOLD_MS) {
            const heartbeatPayload = {
                id: visitorId,
                company_id: companyId,
                timestamp: new Date().toISOString()
            };
            sendToBackend(heartbeatPayload, '/api/pixel/sessions/heartbeat', 1);
        } else {
            console.log('[VisitorTracker] Skipping heartbeat: user inactive.');
        }
    }, HEARTBEAT_INTERVAL_MS);
})();