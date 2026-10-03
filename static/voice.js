// =========================================================
// CT VOICE - voice.js
// =========================================================
let currentUsername = "";
let currentUserId = null;
let livekitRoom = null;
let localAudioTrack = null;
let isMicrophoneMuted = false;
let statusTimer = null;
// =========================================================
// ELEMENTS
// =========================================================
const verificationCard = document.getElementById("verificationCard");
const microphoneCard = document.getElementById("microphoneCard");
const codeCard = document.getElementById("codeCard");
const voiceCard = document.getElementById("voiceCard");
const usernameInput = document.getElementById("username");
const verificationCode = document.getElementById("verificationCode");
const message = document.getElementById("message");
const declineMessage = document.getElementById("declineMessage");
const codeMessage = document.getElementById("codeMessage");
const voiceMessage = document.getElementById("voiceMessage");
const checkButton = document.getElementById("checkButton");
// =========================================================
// HELPERS
// =========================================================
function showElement(element) {
    if (element) {
        element.classList.remove("hidden");
    }
}
function hideElement(element) {
    if (element) {
        element.classList.add("hidden");
    }
}
function showMessage(element, text) {
    if (!element) return;
    element.textContent = text;
    element.classList.remove("hidden");
}
function clearMessage(element) {
    if (!element) return;
    element.textContent = "";
    element.classList.add("hidden");
}
function setButtonLoading(button, loading, text) {
    if (!button) return;
    if (loading) {
        button.dataset.originalText = button.textContent;
        button.disabled = true;
        button.textContent = text || "جارٍ التحقق...";
    } else {
        button.disabled = false;
        button.textContent =
            button.dataset.originalText || text || "تحقق";
    }
}
// =========================================================
// REQUEST VERIFICATION
// =========================================================
async function requestVerification() {
    const username = usernameInput.value.trim();
    clearMessage(message);
    if (!username) {
        showMessage(
            message,
            "اكتب اسم حساب Roblox أولاً."
        );
        return;
    }
    setButtonLoading(
        checkButton,
        true,
        "جارٍ البحث..."
    );
    try {
        const response = await fetch(
            "/auth/request",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    username: username
                })
            }
        );
        const data = await response.json();
        setButtonLoading(
            checkButton,
            false
        );
        // =============================================
        // ACCOUNT NOT FOUND
        // =============================================
        if (data.status === "account_not_found") {
            showMessage(
                message,
                "❌ " + data.message
            );
            return;
        }
        // =============================================
        // NOT INSIDE GAME
        // =============================================
        if (data.status === "not_in_game") {
            showMessage(
                message,
                "⚠️ " + data.message
            );
            return;
        }
        // =============================================
        // 5 MINUTE COOLDOWN
        // =============================================
        if (data.status === "declined_cooldown") {
            const minutes = Math.ceil(
                Number(data.remaining || 300) / 60
            );
            showMessage(
                message,
                `⏳ رفضت تفعيل المايك. حاول بعد ${minutes} دقيقة.`
            );
            return;
        }
        // =============================================
        // SUCCESS
        // =============================================
        if (data.success && data.status === "found") {
            currentUsername = data.username;
            currentUserId = Number(data.user_id);
            hideElement(verificationCard);
            showElement(microphoneCard);
            clearMessage(message);
            clearMessage(declineMessage);
            return;
        }
        showMessage(
            message,
            data.message || "حدث خطأ غير متوقع."
        );
    } catch (error) {
        setButtonLoading(
            checkButton,
            false
        );
        showMessage(
            message,
            "تعذر الاتصال بالسيرفر. حاول مرة أخرى."
        );
        console.error(error);
    }
}
// =========================================================
// ACCEPT MICROPHONE
// =========================================================
async function acceptMicrophone() {
    clearMessage(declineMessage);
    if (!currentUsername) {
        showMessage(
            declineMessage,
            "انتهت جلسة التحقق. أعد المحاولة."
        );
        return;
    }
    try {
        /*
         * يتم إنشاء رمز التحقق في السيرفر.
         *
         * الموقع لا يعرف الرمز ولا يعرضه للمستخدم.
         * سكربت Roblox هو الذي سيقرأ الرمز ويعرضه داخل اللعبة.
         */
        const response = await fetch(
            "/auth/request",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    username: currentUsername
                })
            }
        );
        const data = await response.json();
        if (!data.success) {
            showMessage(
                declineMessage,
                data.message || "تعذر إنشاء رمز التحقق."
            );
            return;
        }
        currentUserId = Number(data.user_id);
        currentUsername = data.username;
        hideElement(microphoneCard);
        showElement(codeCard);
        verificationCode.value = "";
        clearMessage(codeMessage);
        verificationCode.focus();
    } catch (error) {
        showMessage(
            declineMessage,
            "تعذر الاتصال بالسيرفر."
        );
        console.error(error);
    }
}
// =========================================================
// DECLINE MICROPHONE
// =========================================================
async function declineMicrophone() {
    clearMessage(declineMessage);
    if (!currentUsername) {
        hideElement(microphoneCard);
        showElement(verificationCard);
        return;
    }
    try {
        await fetch(
            "/auth/decline",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    username: currentUsername
                })
            }
        );
    } catch (error) {
        console.error(error);
    }
    /*
     * لا نعرض رسالة جديدة للمستخدم.
     *
     * يتم إخفاء صفحة التفعيل.
     * السيرفر يمنع طلب جديد لمدة 5 دقائق.
     */
    hideElement(microphoneCard);
    currentUsername = "";
    currentUserId = null;
}
// =========================================================
// VERIFY CODE
// =========================================================
async function verifyCode() {
    const code = verificationCode.value
        .trim()
        .toUpperCase();
    clearMessage(codeMessage);
    if (!currentUsername || !currentUserId) {
        showMessage(
            codeMessage,
            "انتهت جلسة التحقق. ابدأ من جديد."
        );
        return;
    }
    if (code.length !== 8) {
        showMessage(
            codeMessage,
            "رمز التحقق يجب أن يكون 8 خانات."
        );
        return;
    }
    try {
        const response = await fetch(
            "/auth/verify",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    username: currentUsername,
                    code: code
                })
            }
        );
        const data = await response.json();
        // =============================================
        // WRONG CODE
        // =============================================
        if (data.status === "wrong_code") {
            showMessage(
                codeMessage,
                `❌ رمز التحقق غير صحيح. المحاولات المتبقية: ${data.remaining_attempts}`
            );
            verificationCode.select();
            return;
        }
        // =============================================
        // EXPIRED
        // =============================================
        if (data.status === "expired") {
            showMessage(
                codeMessage,
                "⏳ انتهت صلاحية الرمز. ابدأ التحقق من جديد."
            );
            return;
        }
        // =============================================
        // TOO MANY ATTEMPTS
        // =============================================
        if (data.status === "too_many_attempts") {
            showMessage(
                codeMessage,
                "❌ تم تجاوز عدد المحاولات. ابدأ التحقق من جديد."
            );
            return;
        }
        // =============================================
        // PLAYER LEFT
        // =============================================
        if (data.status === "not_in_game") {
            showMessage(
                codeMessage,
                "⚠️ خرجت من سيرفر CT. يجب إعادة التحقق."
            );
            return;
        }
        // =============================================
        // SUCCESS
        // =============================================
        if (data.success && data.status === "verified") {
            currentUserId = Number(data.user_id);
            currentUsername = data.username;
            hideElement(codeCard);
            showElement(voiceCard);
            const voiceUsername =
                document.getElementById("voiceUsername");
            if (voiceUsername) {
                voiceUsername.textContent =
                    currentUsername;
            }
            await connectToVoice();
            startVerificationStatus();
            return;
        }
        showMessage(
            codeMessage,
            data.message || "رمز التحقق غير صحيح."
        );
    } catch (error) {
        showMessage(
            codeMessage,
            "تعذر الاتصال بالسيرفر."
        );
        console.error(error);
    }
}
// =========================================================
// CONNECT TO LIVEKIT
// =========================================================
async function connectToVoice() {
    clearMessage(voiceMessage);
    if (!currentUserId) {
        showMessage(
            voiceMessage,
            "تعذر تحديد حساب Roblox."
        );
        return;
    }
    if (!window.LivekitClient) {
        showMessage(
            voiceMessage,
            "تعذر تحميل نظام الصوت."
        );
        return;
    }
    try {
        const response = await fetch(
            "/voice/token",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    user_id: currentUserId
                })
            }
        );
        const data = await response.json();
        if (!response.ok || !data.success) {
            showMessage(
                voiceMessage,
                "تعذر إنشاء اتصال الصوت."
            );
            return;
        }
        // =============================================
        // CREATE ROOM
        // =============================================
        livekitRoom =
            new LivekitClient.Room();
        // =============================================
        // DISCONNECTED
        // =============================================
        livekitRoom.on(
            LivekitClient.RoomEvent.Disconnected,
            () => {
                localAudioTrack = null;
                setVoiceStatus(
                    "غير متصل بالصوت",
                    false
                );
            }
        );
        // =============================================
        // CONNECT
        // =============================================
        await livekitRoom.connect(
            data.url,
            data.token
        );
        // =============================================
        // MICROPHONE
        // =============================================
        await enableMicrophone();
        setVoiceStatus(
            "متصل بالصوت",
            true
        );
    } catch (error) {
        console.error(error);
        showMessage(
            voiceMessage,
            "تعذر الاتصال بخدمة الصوت."
        );
    }
}
// =========================================================
// ENABLE MICROPHONE
// =========================================================
async function enableMicrophone() {
    if (!livekitRoom) return;
    try {
        await livekitRoom.localParticipant.setMicrophoneEnabled(
            true
        );
        isMicrophoneMuted = false;
        updateMicrophoneButton();
    } catch (error) {
        console.error(error);
        showMessage(
            voiceMessage,
            "تعذر تشغيل المايك. تأكد من السماح للموقع باستخدام الميكروفون."
        );
    }
}
// =========================================================
// TOGGLE MICROPHONE
// =========================================================
async function toggleMicrophone() {
    if (!livekitRoom) return;
    try {
        const enabled = !isMicrophoneMuted;
        await livekitRoom.localParticipant.setMicrophoneEnabled(
            !enabled
        );
        isMicrophoneMuted = enabled;
        updateMicrophoneButton();
    } catch (error) {
        console.error(error);
        showMessage(
            voiceMessage,
            "تعذر تغيير حالة المايك."
        );
    }
}
// =========================================================
// MICROPHONE BUTTON UI
// =========================================================
function updateMicrophoneButton() {
    const micIcon =
        document.getElementById("micIcon");
    const micText =
        document.getElementById("micText");
    const micButton =
        document.getElementById("micButton");
    if (!micIcon || !micText || !micButton) {
        return;
    }
    if (isMicrophoneMuted) {
        micIcon.textContent = "🔇";
        micText.textContent = "فتح المايك";
        micButton.classList.add("muted");
    } else {
        micIcon.textContent = "🎙️";
        micText.textContent = "كتم المايك";
        micButton.classList.remove("muted");
    }
}
// =========================================================
// VOICE STATUS
// =========================================================
function setVoiceStatus(text, connected) {
    const status =
        document.getElementById("voiceStatus");
    const dot =
        document.getElementById("statusDot");
    if (status) {
        status.textContent = text;
    }
    if (dot) {
        if (connected) {
            dot.classList.add("connected");
        } else {
            dot.classList.remove("connected");
        }
    }
}
// =========================================================
// LEAVE CONFIRMATION
// =========================================================
function showLeaveConfirmation() {
    const modal =
        document.getElementById("leaveModal");
    if (modal) {
        modal.classList.remove("hidden");
    }
}
function hideLeaveConfirmation() {
    const modal =
        document.getElementById("leaveModal");
    if (modal) {
        modal.classList.add("hidden");
    }
}
// =========================================================
// CONFIRM LEAVE
// =========================================================
async function confirmLeaveVoice() {
    hideLeaveConfirmation();
    await leaveVoice();
}
// =========================================================
// LEAVE VOICE
// =========================================================
async function leaveVoice() {
    stopVerificationStatus();
    try {
        if (livekitRoom) {
            await livekitRoom.disconnect();
            livekitRoom = null;
        }
    } catch (error) {
        console.error(error);
    }
    localAudioTrack = null;
    isMicrophoneMuted = false;
    currentUsername = "";
    currentUserId = null;
    verificationCode.value = "";
    hideElement(voiceCard);
    hideElement(codeCard);
    hideElement(microphoneCard);
    showElement(verificationCard);
    usernameInput.value = "";
    clearMessage(message);
    clearMessage(codeMessage);
    clearMessage(voiceMessage);
    setVoiceStatus(
        "غير متصل بالصوت",
        false
    );
    updateMicrophoneButton();
}
// =========================================================
// CHECK SESSION
// =========================================================
async function checkVerificationStatus() {
    if (!currentUserId) return;
    try {
        const response = await fetch(
            `/auth/status/${currentUserId}`
        );
        const data = await response.json();
        if (!data.verified) {
            /*
             * اللاعب خرج من الماب.
             * ننهي اتصال CT Voice.
             */
            if (livekitRoom) {
                try {
                    await livekitRoom.disconnect();
                } catch (_) {}
            }
            livekitRoom = null;
            stopVerificationStatus();
            hideElement(voiceCard);
            showElement(verificationCard);
            currentUsername = "";
            currentUserId = null;
            showMessage(
                message,
                "⚠️ خرجت من سيرفر CT. يجب إعادة التحقق عند دخولك مرة أخرى."
            );
        }
    } catch (error) {
        console.error(error);
    }
}
// =========================================================
// STATUS TIMER
// =========================================================
function startVerificationStatus() {
    stopVerificationStatus();
    statusTimer = setInterval(
        checkVerificationStatus,
        10000
    );
}
function stopVerificationStatus() {
    if (statusTimer) {
        clearInterval(statusTimer);
        statusTimer = null;
    }
}
// =========================================================
// CODE INPUT
// =========================================================
if (verificationCode) {
    verificationCode.addEventListener(
        "input",
        () => {
            verificationCode.value =
                verificationCode.value
                    .replace(/[^a-zA-Z0-9]/g, "")
                    .toUpperCase()
                    .slice(0, 8);
        }
    );
    verificationCode.addEventListener(
        "keydown",
        (event) => {
            if (event.key === "Enter") {
                verifyCode();
            }
        }
    );
}
// =========================================================
// USERNAME ENTER
// =========================================================
if (usernameInput) {
    usernameInput.addEventListener(
        "keydown",
        (event) => {
            if (event.key === "Enter") {
                requestVerification();
            }
        }
    );
}
// =========================================================
// CLOSE MODAL BY CLICKING OUTSIDE
// =========================================================
const leaveModal =
    document.getElementById("leaveModal");
if (leaveModal) {
    leaveModal.addEventListener(
        "click",
        (event) => {
            if (event.target === leaveModal) {
                hideLeaveConfirmation();
            }
        }
    );
}
// =========================================================
// INITIAL STATE
// =========================================================
updateMicrophoneButton();
