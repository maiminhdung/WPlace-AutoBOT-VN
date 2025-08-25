const cookieDomain = ".backend.wplace.live";

async function preserveAndResetJ() {
    let savedValue = null;

    try {
        const oldJ = await chrome.cookies.get({
            url: "https://backend.wplace.live/",
            name: "j",
        });

        if (oldJ && oldJ.value) {
            savedValue = oldJ.value.trim();
            console.log("[bg] Saved j cookie:", savedValue);

            const accountInfo = await checkTokenAndGetInfo(savedValue);

            if (accountInfo) {
                const store = await chrome.storage.local.get("infoAccounts");
                let infoAccounts = store.infoAccounts || [];

                const existingIndex = infoAccounts.findIndex(account => account.ID === accountInfo.ID);

                if (existingIndex > -1) {
                    infoAccounts[existingIndex].token = accountInfo.token;
                    infoAccounts[existingIndex].name = accountInfo.name;
                    console.log(`✅ ID ${accountInfo.ID} found. Overwriting token.`);
                } else {
                    infoAccounts.push(accountInfo);
                    console.log(`✅ New account added: ${accountInfo.name} (${accountInfo.ID}).`);
                }

                await chrome.storage.local.set({ infoAccounts });
                await exportInfoAccount();

            } else {
                console.warn("❌ Current token is invalid, not saving.");
            }
        } else {
            console.warn("[bg] No 'j' cookie found. Skipping account verification.");
        }

        setTimeout(async () => {
            await new Promise((resolve) => {
                chrome.browsingData.remove(
                    { origins: ["https://wplace.live"] },
                    { cookies: true },
                    () => {
                        console.log("[bg] Nuke done (delayed)");
                        resolve();
                    }
                );
            });

            if (savedValue) {
                setCookie(savedValue);
            } else {
                console.log("[bg] No j to restore, leaving nuked");
            }
        }, 2000);

    } catch (err) {
        console.error("[bg] Error in preserveAndResetJ:", err);
    }
}

async function filterInvalid() {
    const store = await chrome.storage.local.get("infoAccounts");
    let infoAccounts = store.infoAccounts || [];
    let validAccounts = [];

    for (const account of infoAccounts) {
        // This is a simplified check for validity
        const isValid = await checkTokenAndGetInfo(account.token);
        if (isValid) {
            validAccounts.push(account);
            console.log("Token valid:", account.token);
        } else {
            console.log("Token invalid:", account.token);
        }
    }

    await chrome.storage.local.set({ infoAccounts: validAccounts });
    console.log(`✅ Filtered and saved ${validAccounts.length} valid accounts.`);
}


async function exportInfoAccount() {
    const store = await chrome.storage.local.get("infoAccounts");
    const infoAccounts = store.infoAccounts || [];
    const accounts = infoAccounts.map(info => info.token);
    await chrome.storage.local.set({ accounts });
}

async function checkTokenAndGetInfo(token) {
    if (!token) {
        return null;
    }
    console.log("Checking with token:", token);
    try {
        const response = await fetch("https://backend.wplace.live/me", {
            method: "GET",
            headers: { "Authorization": `Bearer ${token}` }
        });

        if (response.ok) {
            const data = await response.json();
            console.log("Token returned:", data);
            return {
                ID: data.id,
                name: data.name,
                token: token
            };
        }

        if (response.status === 401) {
            console.log("Token invalid: Unauthorized (401)");
        } else {
            console.error(`⚠️ Token check failed with status: ${response.status}`);
        }
        return null;

    } catch (e) {
        console.error("❌ Network or fetch error:", e);
        return null;
    }
}

chrome.webNavigation.onCompleted.addListener(
    (details) => {
        if (details.url.includes("wplace.live")) {
            console.log("[bg] Page load detected → nuking cookies");
            preserveAndResetJ();
        }
    },
    { url: [{ hostContains: "wplace.live" }] }
);

async function setCookie(value) {
    const cleaned = value.trim();
    console.log("[bg] setCookie CALLED with:", cleaned);

    chrome.cookies.set(
        {
            url: "https://backend.wplace.live/",
            name: "j",
            value: cleaned,
            domain: cookieDomain,
            path: "/",
        },
        (cookie) => {
            if (chrome.runtime.lastError) {
                console.error(
                    "[bg] cookie set error:",
                    chrome.runtime.lastError.message
                );
            } else {
                console.log("[bg] cookie set result:", cookie);

                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs.length > 0) {
                        chrome.tabs.sendMessage(tabs[0].id, {
                            type: "cookieSet",
                            value: cleaned,
                        });
                    }
                });
            }
        }
    );
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    console.log("📩 Background received message:", msg);

    if (msg.type === "setCookie" && msg.value) {
        (async () => {
            try {
                console.log("🍪 Setting cookie...");
                await setCookie(msg.value);
                console.log("✅ Cookie set successfully");
                sendResponse({ status: "ok" });
            } catch (e) {
                console.error("❌ setCookie failed", e);
                sendResponse({ status: "error", error: e.message });
            }
        })();
        return true;
    }

    if (msg.type === "getAccounts") {
        filterInvalid();
        console.log("📂 Fetching accounts...");
        chrome.storage.local.get("accounts", (res) => {
            console.log("📤 Returning accounts:", res.accounts);
            sendResponse({ accounts: res.accounts || [] });
        });
        return true;
    }
});
