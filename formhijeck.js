(function () {
    // === CONFIG ===
    const API_ENDPOINT = "https://lenz.grayphite.com/pixel/api/";
    const COOKIE_NAME = "lenz_visitor_id";
    const COOKIE_EXPIRY_DAYS = 365;
    const HEARTBEAT_INTERVAL_MS = 0.5 * 60 * 1000;
    const INACTIVITY_THRESHOLD_MS = 0.5 * 60 * 1000;

    let lastActivityTime = Date.now();
    let myPhone = "";
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
    async function sendToBackend(payloaad, endpoint, requestType = 0) {
        // requestType 0: session, 1: heartbeat, 2: phone number request, 3: form submit,
        const ip_address = await userIPPromise;
        const payloadToSend = {
            session_id: visitorId,
            company_id: companyId,
            ...(requestType == 3 ? {
                additional_data: {
                    ...payloaad,
                }
            } : {}),
            ...(requestType == 0 ? {
                referrer: document.referrer || "direct",
                utmParams: extractUTMParams(),
                landing: window.location.href,
                pagePath: window.location.pathname + window.location.search,
                userAgent: navigator.userAgent,
                ip_address,
            } : {}),

        };
        if (requestType == 1 || requestType == 2) {
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
                if (requestType == 2) {
                    const data = await response.json(); // or response.text() if not JSON
                    myPhone = data?.phone;
                    myPhone && replacePhones(document.body)
                }
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
     * @param {boolean} formType - if true, skip fields inside forms
     */
    function collectFields(container, formType = 0) {
        // formType 0: fields inside forms, 1:  all fields
        const fields = container.querySelectorAll("input, textarea, select");
        const data = {};
        let counter = 0; // for unique keys for unnamed inputs

        fields.forEach((field) => {
            if (formType && field.closest("form")) return;

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

    // === MutationObserver for dynamically added forms ===
    new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (!(node instanceof HTMLElement)) return;

                // Forms
                if (node.tagName === "FORM" && !node.dataset.crNoCapture) {
                    window.captureForm(node);
                }

                // Buttons
                if (
                    node.tagName === "BUTTON" ||
                    node.getAttribute("role") === "button" ||
                    (node.tagName === "INPUT" && node.type === "button")
                ) {
                    hookButtons();
                }
            });
        });
    }).observe(document.body, { childList: true, subtree: true });

    let lastUrl = location.href;
    new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;

        }
    }).observe(document, { subtree: true, childList: true });

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
        // Initialize visitor session and phone request
        console.debug('[VisitorTracker] Session Info:');
        sendToBackend({}, 'sessions', 0);
        sendToBackend({}, 'sessions/request_phone_number', 2);

        // Setup user activity tracking
        setupActivityListeners();
    });

    setInterval(() => {
        const now = Date.now();
        const inactiveFor = now - lastActivityTime;

        if (inactiveFor < INACTIVITY_THRESHOLD_MS) {
            const heartbeatPayload = {
                id: visitorId,
                company_id: companyId,
                timestamp: new Date().toISOString()
            };
            sendToBackend(heartbeatPayload, 'sessions/heartbeat', 1);
        } else {
            console.log('[VisitorTracker] Skipping heartbeat: user inactive.');
        }
    }, HEARTBEAT_INTERVAL_MS);


    document.addEventListener("click", function (e) {
        let btn = e.target.closest("button, [role=button], input[type=button], .btn, .submit");
        if (!btn) return;

        const container = btn.closest("form") || btn.closest("[data-form]") || document.body;
        try {
            const isForm = container.tagName === "FORM";
            const data = collectFields(container, isForm ? 0 : 1);
            data._page = window.location.href;
            data._event = "button_click";
            sendToBackend(data, 'collect/form', 3);
        } catch (err) {
            console.error("Error capturing button click:", err);
        }
    }, true);

    // MutationObserver to catch new forms/buttons
    new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (!(node instanceof HTMLElement)) return;

                if (node.tagName === "FORM" && !node.dataset.crNoCapture) {
                    console.log("[VisitorTracker] New form detected");
                }
                if (node.tagName === "BUTTON") {
                    console.log("[VisitorTracker] New button detected");
                }
            });
        });
    }).observe(document.body, { childList: true, subtree: true });
})();
