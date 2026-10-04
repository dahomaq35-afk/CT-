// =========================================================
// CT VOICE - voice.js
// FULL STABLE VERSION
// Same systems - connection fixes only
// =========================================================

let currentUsername = "";
let currentUserId = null;

let livekitRoom = null;
let localAudioTrack = null;

let isMicrophoneMuted = false;

let statusTimer = null;
let playersTimer = null;
let codeTimerInterval = null;

let connectedToVoice = false;
let connectingToVoice = false;


// =========================================================
// ELEMENTS
// =========================================================

const authCard = document.getElementById("authCard");
const usernameStep = document.getElementById("usernameStep");
const microphoneStep = document.getElementById("microphoneStep");
const codeStep = document.getElementById("codeStep");
const voiceCard = document.getElementById("voiceCard");
const adminCard = document.getElementById("adminCard");

const usernameInput = document.getElementById("username");
const verificationCode = document.getElementById("verificationCode");
const authMessage = document.getElementById("authMessage");

const verifyAccountBtn = document.getElementById("verifyAccountBtn");
const microphoneYesBtn = document.getElementById("microphoneYesBtn");
const microphoneNoBtn = document.getElementById("microphoneNoBtn");
const verifyCodeBtn = document.getElementById("verifyCodeBtn");
const backToMicrophoneBtn = document.getElementById("backToMicrophoneBtn");

const micToggleBtn = document.getElementById("micToggleBtn");
const leaveVoiceBtn = document.getElementById("leaveVoiceBtn");

const confirmLeaveBtn = document.getElementById("confirmLeaveBtn");
const cancelLeaveBtn = document.getElementById("cancelLeaveBtn");


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


function showMessage(text) {
    if (!authMessage) {
        console.error("[CT Voice] authMessage not found:", text);
        return;
    }

    authMessage.textContent = text;
    authMessage.classList.remove("hidden");
}


function clearMessage() {
    if (!authMessage) return;

    authMessage.textContent = "";
    authMessage.classList.add("hidden");
}


function setButtonLoading(
    button,
    loading,
    loadingText = "جارٍ التحقق..."
) {
    if (!button) return;

    if (loading) {
        if (!button.dataset.originalText) {
            button.dataset.originalText = button.textContent;
        }

        button.disabled = true;
        button.textContent = loadingText;
    } else {
        button.disabled = false;

        if (button.dataset.originalText) {
            button.textContent = button.dataset.originalText;
        }
    }
}


// =========================================================
// FETCH WITH TIMEOUT
// =========================================================

async function fetchWithTimeout(
    url,
    options = {},
    timeoutMs = 15000
) {
    const controller = new AbortController();

    const timeout = setTimeout(() => {
        controller.abort();
    }, timeoutMs);

    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal,
            cache: "no-store"
        });
    } finally {
        clearTimeout(timeout);
    }
}


// =========================================================
// LIVEKIT CONNECTION TIMEOUT
// =========================================================

function connectLiveKitWithTimeout(
    room,
    url,
    token,
    timeoutMs = 20000
) {
    return new Promise((resolve, reject) => {
        let finished = false;

        const timer = setTimeout(() => {
            if (finished) return;

            finished = true;

            reject(
                new Error(
                    "LIVEKIT_CONNECTION_TIMEOUT"
                )
            );
        }, timeoutMs);

        room.connect(url, token)
            .then(() => {
                if (finished) return;

                finished = true;
                clearTimeout(timer);

                resolve();
            })
            .catch(error => {
                if (finished) return;

                finished = true;
                clearTimeout(timer);

                reject(error);
            });
    });
}


// =========================================================
// SAFE RESPONSE
// =========================================================

async function readResponse(response) {

    const raw = await response.text();

    if (!raw) {
        return {
            success: false,
            status: "empty_response",
            message:
                `السيرفر لم يرجع أي بيانات. HTTP ${response.status}`
        };
    }

    try {
        return JSON.parse(raw);

    } catch (error) {

        console.error(
            "[CT Voice] Invalid JSON:",
            raw
        );

        return {
            success: false,
            status: "invalid_response",
            message:
                `السيرفر أرسل استجابة غير صالحة. HTTP ${response.status}`
        };
    }
}


// =========================================================
// REQUEST VERIFICATION
// =========================================================

async function requestVerification() {

    const username = usernameInput
        ? usernameInput.value.trim()
        : "";

    clearMessage();

    if (!username) {
        showMessage(
            "❌ اكتب اسم حساب Roblox أولاً."
        );
        return;
    }

    setButtonLoading(
        verifyAccountBtn,
        true,
        "جارٍ البحث..."
    );

    try {

        const response = await fetchWithTimeout(
            "/auth/request",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    username: username
                })
            },
            15000
        );

        const data =
            await readResponse(response);

        console.log(
            "[CT Voice] Auth Response:",
            response.status,
            data
        );

        setButtonLoading(
            verifyAccountBtn,
            false
        );


        if (
            data.status ===
            "account_not_found"
        ) {

            showMessage(
                "❌ " +
                (
                    data.message ||
                    "لم يتم العثور على حساب Roblox بهذا الاسم."
                )
            );

            return;
        }


        if (
            data.status ===
            "not_in_game"
        ) {

            showMessage(
                "⚠️ " +
                (
                    data.message ||
                    "الحساب موجود، لكن يجب أن تكون داخل سيرفر CT."
                )
            );

            return;
        }


        if (
            data.status ===
            "declined_cooldown"
        ) {

            const seconds =
                Number(
                    data.remaining || 300
                );

            const minutes =
                Math.max(
                    1,
                    Math.ceil(
                        seconds / 60
                    )
                );

            showMessage(
                `⏳ رفضت تفعيل المايك. حاول بعد ${minutes} دقيقة.`
            );

            return;
        }


        if (
            data.status ===
            "invalid_username"
        ) {

            showMessage(
                "❌ " +
                (
                    data.message ||
                    "اسم Roblox غير صالح."
                )
            );

            return;
        }


        if (
            data.success === true &&
            data.status === "found"
        ) {

            currentUsername =
                data.username || username;

            currentUserId =
                Number(data.user_id);


            const foundUsername =
                document.getElementById(
                    "foundUsername"
                );

            if (foundUsername) {

                foundUsername.textContent =
                    `تم العثور على حساب: ${currentUsername}`;
            }


            hideElement(usernameStep);
            hideElement(codeStep);

            showElement(microphoneStep);

            clearMessage();

            return;
        }


        showMessage(
            "❌ " +
            (
                data.message ||
                data.detail ||
                `حدث خطأ من السيرفر. HTTP ${response.status}`
            )
        );

    } catch (error) {

        setButtonLoading(
            verifyAccountBtn,
            false
        );

        if (
            error &&
            error.name === "AbortError"
        ) {

            showMessage(
                "⏱️ السيرفر تأخر في الرد. تأكد أن Render يعمل ثم حاول مرة أخرى."
            );

        } else {

            showMessage(
                "❌ تعذر الاتصال بالسيرفر."
            );
        }

        console.error(
            "[CT Voice] Auth Error:",
            error
        );
    }
}


// =========================================================
// ACCEPT MICROPHONE
// =========================================================

async function acceptMicrophone() {

    clearMessage();

    if (!currentUsername) {

        showMessage(
            "❌ انتهت جلسة التحقق. أعد المحاولة."
        );

        return;
    }

    setButtonLoading(
        microphoneYesBtn,
        true,
        "جارٍ إنشاء الرمز..."
    );

    try {

        const response = await fetchWithTimeout(
            "/auth/request",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    username: currentUsername
                })
            },
            15000
        );

        const data =
            await readResponse(response);

        console.log(
            "[CT Voice] Code Request:",
            response.status,
            data
        );

        setButtonLoading(
            microphoneYesBtn,
            false
        );


        if (
            !response.ok ||
            !data.success
        ) {

            if (
                data.status ===
                "not_in_game"
            ) {

                showMessage(
                    "⚠️ " +
                    (
                        data.message ||
                        "يجب أن تكون داخل سيرفر CT."
                    )
                );

            } else {

                showMessage(
                    "❌ " +
                    (
                        data.message ||
                        data.detail ||
                        "تعذر إنشاء رمز التحقق."
                    )
                );
            }

            return;
        }


        currentUserId =
            Number(data.user_id);

        currentUsername =
            data.username ||
            currentUsername;


        const codeUsername =
            document.getElementById(
                "codeUsername"
            );

        if (codeUsername) {

            codeUsername.textContent =
                currentUsername;
        }


        hideElement(microphoneStep);

        showElement(codeStep);


        if (verificationCode) {

            verificationCode.value = "";

            setTimeout(() => {
                try {
                    verificationCode.focus();
                } catch (_) {}
            }, 100);
        }


        startCodeTimer();

        clearMessage();

    } catch (error) {

        setButtonLoading(
            microphoneYesBtn,
            false
        );

        if (
            error &&
            error.name === "AbortError"
        ) {

            showMessage(
                "⏱️ السيرفر تأخر في إنشاء الرمز."
            );

        } else {

            showMessage(
                "❌ تعذر الاتصال بالسيرفر."
            );
        }

        console.error(
            "[CT Voice] Microphone Error:",
            error
        );
    }
}


// =========================================================
// DECLINE MICROPHONE
// =========================================================

async function declineMicrophone() {

    clearMessage();

    if (!currentUsername) {

        hideElement(microphoneStep);
        showElement(usernameStep);

        return;
    }

    setButtonLoading(
        microphoneNoBtn,
        true,
        "جارٍ..."
    );

    try {

        await fetchWithTimeout(
            "/auth/decline",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    username: currentUsername
                })
            },
            10000
        );

    } catch (error) {

        console.error(
            "[CT Voice] Decline Error:",
            error
        );

    } finally {

        setButtonLoading(
            microphoneNoBtn,
            false
        );
    }


    currentUsername = "";
    currentUserId = null;

    hideElement(microphoneStep);
    hideElement(codeStep);

    showElement(usernameStep);

    clearMessage();
}


// =========================================================
// CODE TIMER
// =========================================================

function startCodeTimer() {

    stopCodeTimer();

    let remaining = 600;

    updateCodeTimer(
        remaining
    );

    codeTimerInterval =
        setInterval(() => {

            remaining--;

            updateCodeTimer(
                remaining
            );

            if (
                remaining <= 0
            ) {

                stopCodeTimer();

                showMessage(
                    "⏳ انتهت صلاحية رمز التحقق. اضغط العودة ثم أعد المحاولة."
                );
            }

        }, 1000);
}


function stopCodeTimer() {

    if (codeTimerInterval) {

        clearInterval(
            codeTimerInterval
        );

        codeTimerInterval = null;
    }
}


function updateCodeTimer(seconds) {

    const timer =
        document.getElementById(
            "codeTimer"
        );

    if (!timer) return;

    const safeSeconds =
        Math.max(
            0,
            Number(seconds)
        );

    const minutes =
        Math.floor(
            safeSeconds / 60
        );

    const secs =
        safeSeconds % 60;

    timer.textContent =
        `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}


// =========================================================
// BACK TO MICROPHONE
// =========================================================

function backToMicrophone() {

    stopCodeTimer();

    clearMessage();

    hideElement(codeStep);
    showElement(microphoneStep);

    if (verificationCode) {
        verificationCode.value = "";
    }
}


// =========================================================
// VERIFY CODE
// =========================================================

async function verifyCode() {

    const code =
        verificationCode
            ? verificationCode.value
                .trim()
                .toUpperCase()
            : "";

    clearMessage();

    if (
        !currentUsername ||
        !currentUserId
    ) {

        showMessage(
            "❌ انتهت جلسة التحقق. ابدأ من جديد."
        );

        return;
    }


    if (code.length !== 8) {

        showMessage(
            "❌ رمز التحقق يجب أن يكون 8 خانات."
        );

        return;
    }


    setButtonLoading(
        verifyCodeBtn,
        true,
        "جارٍ التحقق..."
    );

    try {

        const response =
            await fetchWithTimeout(
                "/auth/verify",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        username:
                            currentUsername,
                        code:
                            code
                    })
                },
                15000
            );


        const data =
            await readResponse(
                response
            );


        console.log(
            "[CT Voice] Verify Response:",
            response.status,
            data
        );


        setButtonLoading(
            verifyCodeBtn,
            false
        );


        if (
            data.status ===
            "wrong_code"
        ) {

            const remaining =
                data.remaining_attempts;

            let text =
                data.message ||
                "رمز التحقق غير صحيح.";

            if (
                remaining !==
                undefined
            ) {

                text +=
                    ` المحاولات المتبقية: ${remaining}`;
            }

            showMessage(
                "❌ " + text
            );

            if (verificationCode) {
                verificationCode.select();
            }

            return;
        }


        if (
            data.status ===
            "expired"
        ) {

            showMessage(
                "⏳ " +
                (
                    data.message ||
                    "انتهت صلاحية الرمز."
                )
            );

            return;
        }


        if (
            data.status ===
            "too_many_attempts"
        ) {

            showMessage(
                "❌ " +
                (
                    data.message ||
                    "تم تجاوز عدد المحاولات."
                )
            );

            return;
        }


        if (
            data.status ===
            "not_in_game"
        ) {

            showMessage(
                "⚠️ " +
                (
                    data.message ||
                    "خرجت من سيرفر CT."
                )
            );

            return;
        }


        if (
            data.success === true &&
            data.status === "verified"
        ) {

            currentUserId =
                Number(data.user_id);

            currentUsername =
                data.username ||
                currentUsername;


            stopCodeTimer();


            hideElement(authCard);

            showElement(voiceCard);


            const voiceUsername =
                document.getElementById(
                    "voiceUsername"
                );

            if (voiceUsername) {

                voiceUsername.textContent =
                    currentUsername;
            }


            const currentPlayerName =
                document.getElementById(
                    "currentPlayerName"
                );

            if (currentPlayerName) {

                currentPlayerName.textContent =
                    currentUsername;
            }


            const userAvatar =
                document.getElementById(
                    "userAvatar"
                );

            if (userAvatar) {

                userAvatar.textContent =
                    currentUsername
                        .charAt(0)
                        .toUpperCase();
            }


            await connectToVoice();


            startVerificationStatus();
            startPlayersRefresh();

            return;
        }


        showMessage(
            "❌ " +
            (
                data.message ||
                data.detail ||
                "تعذر التحقق من الرمز."
            )
        );

    } catch (error) {

        setButtonLoading(
            verifyCodeBtn,
            false
        );

        if (
            error &&
            error.name === "AbortError"
        ) {

            showMessage(
                "⏱️ السيرفر تأخر في التحقق."
            );

        } else {

            showMessage(
                "❌ تعذر الاتصال بالسيرفر."
            );
        }

        console.error(
            "[CT Voice] Verify Error:",
            error
        );
    }
}


// =========================================================
// CONNECT LIVEKIT
// =========================================================

async function connectToVoice() {

    if (connectingToVoice) {

        console.log(
            "[CT Voice] Connection already in progress."
        );

        return;
    }


    if (
        connectedToVoice &&
        livekitRoom
    ) {

        console.log(
            "[CT Voice] Already connected."
        );

        return;
    }


    if (!currentUserId) {

        showMessage(
            "❌ تعذر تحديد حساب Roblox."
        );

        return;
    }


    if (!window.LivekitClient) {

        console.error(
            "[CT Voice] LiveKit client not loaded."
        );

        showMessage(
            "❌ تعذر تحميل نظام الصوت. أعد تحميل الصفحة."
        );

        return;
    }


    connectingToVoice = true;

    setVoiceStatus(
        "جاري الاتصال بالصوت...",
        false
    );

    updateCurrentStatus();


    try {

        console.log(
            "[CT Voice] Requesting voice token..."
        );


        // =================================================
        // GET TOKEN
        // =================================================

        const response =
            await fetchWithTimeout(
                "/voice/token",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        user_id:
                            currentUserId
                    })
                },
                15000
            );


        const data =
            await readResponse(
                response
            );


        console.log(
            "[CT Voice] Voice Token Response:",
            response.status,
            data
        );


        if (
            !response.ok ||
            !data.success
        ) {

            showMessage(
                "❌ " +
                (
                    data.message ||
                    data.detail ||
                    "تعذر إنشاء اتصال الصوت."
                )
            );

            setVoiceStatus(
                "تعذر الاتصال بالصوت",
                false
            );

            updateCurrentStatus();

            return;
        }


        if (
            !data.url ||
            !data.token
        ) {

            console.error(
                "[CT Voice] Missing LiveKit URL or token:",
                data
            );

            showMessage(
                "❌ السيرفر لم يرجع بيانات اتصال الصوت."
            );

            setVoiceStatus(
                "تعذر الاتصال بالصوت",
                false
            );

            updateCurrentStatus();

            return;
        }


        console.log(
            "[CT Voice] LiveKit URL:",
            data.url
        );


        // =================================================
        // CREATE ROOM
        // =================================================

        livekitRoom =
            new LivekitClient.Room({
                adaptiveStream: true,
                dynacast: true
            });


        // =================================================
        // DISCONNECTED
        // =================================================

        livekitRoom.on(
            LivekitClient.RoomEvent.Disconnected,
            reason => {

                console.log(
                    "[CT Voice] LiveKit disconnected:",
                    reason
                );

                localAudioTrack = null;

                connectedToVoice = false;

                setVoiceStatus(
                    "غير متصل بالصوت",
                    false
                );

                updateCurrentStatus();
            }
        );


        // =================================================
        // ACTIVE SPEAKERS
        // =================================================

        livekitRoom.on(
            LivekitClient.RoomEvent.ActiveSpeakersChanged,
            speakers => {

                handleActiveSpeakers(
                    speakers
                );


                const myIdentity =
                    String(
                        currentUserId
                    );


                const amISpeaking =
                    speakers.some(
                        speaker =>
                            String(
                                speaker.identity
                            ) === myIdentity
                    );


                updateLocalSpeaking(
                    amISpeaking
                );


                sendVoiceState(
                    amISpeaking
                );
            }
        );


        // =================================================
        // PLAYER CONNECTED
        // =================================================

        livekitRoom.on(
            LivekitClient.RoomEvent.ParticipantConnected,
            participant => {

                console.log(
                    "[CT Voice] Player joined:",
                    participant.identity
                );
            }
        );


        // =================================================
        // PLAYER DISCONNECTED
        // =================================================

        livekitRoom.on(
            LivekitClient.RoomEvent.ParticipantDisconnected,
            participant => {

                console.log(
                    "[CT Voice] Player left:",
                    participant.identity
                );

                resetParticipantAudio(
                    participant
                );
            }
        );


        // =================================================
        // AUDIO TRACK SUBSCRIBED
        // =================================================

        livekitRoom.on(
            LivekitClient.RoomEvent.TrackSubscribed,
            (
                track,
                publication,
                participant
            ) => {

                if (
                    track.kind !==
                    LivekitClient.Track.Kind.Audio
                ) {
                    return;
                }


                try {

                    const element =
                        track.attach();


                    element.dataset.userId =
                        String(
                            participant.identity
                        );


                    element.autoplay = true;

                    element.setAttribute(
                        "playsinline",
                        ""
                    );


                    element.style.display =
                        "none";


                    element.volume = 1;


                    document.body.appendChild(
                        element
                    );


                    element.play()
                        .catch(error => {

                            console.warn(
                                "[CT Voice] Audio play waiting:",
                                error
                            );
                        });


                    console.log(
                        "[CT Voice] Audio connected:",
                        participant.identity
                    );

                } catch (error) {

                    console.error(
                        "[CT Voice] Audio Attach Error:",
                        error
                    );
                }
            }
        );


        // =================================================
        // AUDIO TRACK REMOVED
        // =================================================

        livekitRoom.on(
            LivekitClient.RoomEvent.TrackUnsubscribed,
            track => {

                try {
                    track.detach();
                } catch (_) {}
            }
        );


        // =================================================
        // CONNECT LIVEKIT
        // =================================================

        console.log(
            "[CT Voice] Connecting to LiveKit..."
        );


        await connectLiveKitWithTimeout(
            livekitRoom,
            data.url,
            data.token,
            20000
        );


        // =================================================
        // CONNECTED
        // =================================================

        connectedToVoice = true;


        console.log(
            "[CT Voice] LiveKit connected."
        );


        // مهم:
        // نعلن الاتصال بالصوت مباشرة.
        // لا ننتظر صلاحية المايك حتى لا يعلق النظام.

        setVoiceStatus(
            "متصل بالصوت",
            true
        );

        updateCurrentStatus();


        // =================================================
        // MICROPHONE
        // =================================================

        enableMicrophone();


        console.log(
            "[CT Voice] Voice connection completed."
        );

    } catch (error) {

        console.error(
            "[CT Voice] LiveKit Error:",
            error
        );


        connectedToVoice = false;


        if (livekitRoom) {

            try {

                await livekitRoom.disconnect();

            } catch (_) {}

            livekitRoom = null;
        }


        setVoiceStatus(
            "تعذر الاتصال بالصوت",
            false
        );

        updateCurrentStatus();


        let message =
            "❌ تعذر الاتصال بخدمة الصوت.";


        if (
            error &&
            error.message ===
            "LIVEKIT_CONNECTION_TIMEOUT"
        ) {

            message =
                "⏱️ انتهت مهلة الاتصال بخدمة الصوت. تأكد من LiveKit ثم حاول مرة أخرى.";

        } else if (
            error &&
            error.name ===
            "AbortError"
        ) {

            message =
                "⏱️ انتهت مهلة الاتصال بالسيرفر.";

        } else if (
            error &&
            error.message
        ) {

            console.error(
                "[CT Voice] Detailed error:",
                error.message
            );
        }


        showMessage(
            message
        );

    } finally {

        connectingToVoice = false;
    }
}


// =========================================================
// ENABLE MICROPHONE
// =========================================================

async function enableMicrophone() {

    if (!livekitRoom) {
        return;
    }


    try {

        await livekitRoom.localParticipant
            .setMicrophoneEnabled(true);


        isMicrophoneMuted = false;


        const publications =
            livekitRoom
                .localParticipant
                .audioTrackPublications;


        if (publications) {

            publications.forEach(
                publication => {

                    if (
                        publication.track
                    ) {

                        localAudioTrack =
                            publication.track;
                    }
                }
            );
        }


        updateMicrophoneButton();

        updateCurrentStatus();

        sendVoiceState();


        console.log(
            "[CT Voice] Microphone enabled."
        );

    } catch (error) {

        console.error(
            "[CT Voice] Enable Mic Error:",
            error
        );


        isMicrophoneMuted = true;


        updateMicrophoneButton();
        updateCurrentStatus();


        showMessage(
            "⚠️ الصوت متصل، لكن تعذر تشغيل المايك. تأكد من السماح للموقع باستخدام الميكروفون."
        );
    }
}


// =========================================================
// TOGGLE MICROPHONE
// =========================================================

async function toggleMicrophone() {

    if (!livekitRoom) {

        showMessage(
            "❌ أنت غير متصل بالصوت."
        );

        return;
    }


    if (!connectedToVoice) {

        showMessage(
            "❌ أنت غير متصل بالصوت."
        );

        return;
    }


    try {

        const shouldMute =
            !isMicrophoneMuted;


        await livekitRoom
            .localParticipant
            .setMicrophoneEnabled(
                !shouldMute
            );


        isMicrophoneMuted =
            shouldMute;


        updateMicrophoneButton();

        updateCurrentStatus();

        sendVoiceState();

    } catch (error) {

        console.error(
            "[CT Voice] Toggle Mic Error:",
            error
        );


        showMessage(
            "❌ تعذر تغيير حالة المايك."
        );
    }
}


// =========================================================
// MICROPHONE BUTTON UI
// =========================================================

function updateMicrophoneButton() {

    if (!micToggleBtn) {
        return;
    }


    const micIcon =
        document.getElementById(
            "micIcon"
        );


    const micText =
        document.getElementById(
            "micText"
        );


    if (isMicrophoneMuted) {

        if (micIcon) {
            micIcon.textContent = "🔇";
        }


        if (micText) {
            micText.textContent =
                "فتح المايك";
        }


        micToggleBtn.classList.add(
            "muted"
        );

    } else {

        if (micIcon) {
            micIcon.textContent = "🎙️";
        }


        if (micText) {
            micText.textContent =
                "كتم المايك";
        }


        micToggleBtn.classList.remove(
            "muted"
        );
    }
}


// =========================================================
// VOICE STATUS
// =========================================================

function setVoiceStatus(
    text,
    connected
) {

    const status =
        document.getElementById(
            "voiceStatus"
        );


    const dot =
        document.getElementById(
            "statusDot"
        );


    if (status) {
        status.textContent = text;
    }


    if (dot) {

        if (connected) {

            dot.classList.add(
                "connected"
            );

        } else {

            dot.classList.remove(
                "connected"
            );
        }
    }
}


// =========================================================
// CURRENT PLAYER STATUS
// =========================================================

function updateCurrentStatus() {

    const status =
        document.getElementById(
            "currentPlayerStatus"
        );


    if (!status) return;


    if (!connectedToVoice) {

        status.textContent =
            "غير متصل بالصوت";

    } else if (
        isMicrophoneMuted
    ) {

        status.textContent =
            "المايك مكتوم";

    } else {

        status.textContent =
            "متصل بالصوت";
    }
}


// =========================================================
// LOCAL SPEAKING
// =========================================================

function updateLocalSpeaking(
    speaking
) {

    const indicator =
        document.getElementById(
            "localSpeakingIndicator"
        );


    if (!indicator) return;


    if (speaking) {

        indicator.classList.add(
            "active"
        );

    } else {

        indicator.classList.remove(
            "active"
        );
    }
}


// =========================================================
// LEAVE MODAL
// =========================================================

function showLeaveConfirmation() {

    const modal =
        document.getElementById(
            "leaveModal"
        );


    if (modal) {
        modal.classList.remove(
            "hidden"
        );
    }
}


function hideLeaveConfirmation() {

    const modal =
        document.getElementById(
            "leaveModal"
        );


    if (modal) {
        modal.classList.add(
            "hidden"
        );
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
    stopPlayersRefresh();
    stopCodeTimer();


    if (currentUserId) {

        try {

            await fetchWithTimeout(
                "/voice/leave",
                {
                    method: "POST",
                    headers: {
                        "Content-Type":
                            "application/json"
                    },
                    body: JSON.stringify({
                        user_id:
                            currentUserId
                    })
                },
                10000
            );

        } catch (error) {

            console.error(
                "[CT Voice] Leave API Error:",
                error
            );
        }
    }


    try {

        if (livekitRoom) {

            await livekitRoom.disconnect();

            livekitRoom = null;
        }

    } catch (error) {

        console.error(
            "[CT Voice] Disconnect Error:",
            error
        );

        livekitRoom = null;
    }


    document
        .querySelectorAll(
            "audio[data-user-id]"
        )
        .forEach(
            element => {

                try {
                    element.pause();
                } catch (_) {}

                element.remove();
            }
        );


    localAudioTrack = null;

    connectedToVoice = false;
    connectingToVoice = false;

    isMicrophoneMuted = false;


    currentUsername = "";
    currentUserId = null;


    if (verificationCode) {
        verificationCode.value = "";
    }


    hideElement(voiceCard);
    hideElement(codeStep);
    hideElement(microphoneStep);

    showElement(authCard);
    showElement(usernameStep);


    if (usernameInput) {
        usernameInput.value = "";
    }


    clearMessage();


    setVoiceStatus(
        "غير متصل بالصوت",
        false
    );


    updateMicrophoneButton();
    updateCurrentStatus();
}


// =========================================================
// CHECK SESSION
// =========================================================

async function checkVerificationStatus() {

    if (!currentUserId) {
        return;
    }


    try {

        const response =
            await fetchWithTimeout(
                `/auth/status/${currentUserId}`,
                {},
                10000
            );


        if (!response.ok) {
            return;
        }


        const data =
            await readResponse(
                response
            );


        if (!data.verified) {

            if (livekitRoom) {

                try {
                    await livekitRoom.disconnect();
                } catch (_) {}
            }


            livekitRoom = null;

            connectedToVoice = false;
            connectingToVoice = false;


            stopVerificationStatus();
            stopPlayersRefresh();


            hideElement(voiceCard);

            showElement(authCard);
            showElement(usernameStep);


            currentUsername = "";
            currentUserId = null;


            setVoiceStatus(
                "غير متصل بالصوت",
                false
            );

            updateCurrentStatus();


            showMessage(
                "⚠️ خرجت من سيرفر CT. يجب إعادة التحقق عند دخولك مرة أخرى."
            );
        }

    } catch (error) {

        console.error(
            "[CT Voice] Status Error:",
            error
        );
    }
}


// =========================================================
// STATUS TIMER
// =========================================================

function startVerificationStatus() {

    stopVerificationStatus();


    statusTimer =
        setInterval(
            checkVerificationStatus,
            5000
        );
}


function stopVerificationStatus() {

    if (statusTimer) {

        clearInterval(
            statusTimer
        );

        statusTimer = null;
    }
}


// =========================================================
// PLAYERS REFRESH
// =========================================================

function startPlayersRefresh() {

    stopPlayersRefresh();


    updatePlayers();


    playersTimer =
        setInterval(
            updatePlayers,
            1000
        );
}


function stopPlayersRefresh() {

    if (playersTimer) {

        clearInterval(
            playersTimer
        );

        playersTimer = null;
    }
}


// =========================================================
// UPDATE PLAYERS
// =========================================================

async function updatePlayers() {

    if (!currentUserId) {
        return;
    }


    try {

        const response =
            await fetchWithTimeout(
                `/voice/players/${currentUserId}`,
                {},
                10000
            );


        if (!response.ok) {
            return;
        }


        const data =
            await readResponse(
                response
            );


        if (
            !data ||
            !Array.isArray(
                data.players
            )
        ) {

            return;
        }


        updatePlayersList(
            data.players
        );


        applyProximityVolume(
            data.players
        );

    } catch (error) {

        console.error(
            "[CT Voice] Players Error:",
            error
        );
    }
}


// =========================================================
// PLAYERS LIST
// =========================================================

function updatePlayersList(
    players
) {

    const container =
        document.getElementById(
            "playersList"
        );


    const count =
        document.getElementById(
            "playersCount"
        );


    if (!container) {
        return;
    }


    const others =
        players.filter(
            player =>
                Number(
                    player.user_id
                ) !==
                Number(
                    currentUserId
                )
        );


    if (count) {

        count.textContent =
            String(
                others.length
            );
    }


    container.innerHTML = "";


    if (
        others.length === 0
    ) {

        container.innerHTML =
            `<div class="empty-players">
                لا يوجد لاعبون آخرون متصلون حاليًا.
            </div>`;

        return;
    }


    for (
        const player of others
    ) {

        const item =
            document.createElement(
                "div"
            );


        item.className =
            "voice-player";


        item.dataset.userId =
            String(
                player.user_id
            );


        if (player.speaking) {

            item.classList.add(
                "speaking"
            );
        }


        if (player.muted) {

            item.classList.add(
                "player-muted"
            );
        }


        const name =
            document.createElement(
                "span"
            );


        name.className =
            "voice-player-name";


        name.textContent =
            player.username ||
            "لاعب";


        const status =
            document.createElement(
                "span"
            );


        status.className =
            "voice-player-status";


        if (player.muted) {

            status.textContent =
                "🔇 مكتوم";

        } else if (
            player.speaking
        ) {

            status.textContent =
                "🟢 يتحدث";

        } else {

            status.textContent =
                "🔊 متصل";
        }


        item.appendChild(name);
        item.appendChild(status);

        container.appendChild(item);
    }
}


// =========================================================
// PROXIMITY
// =========================================================

function applyProximityVolume(
    players
) {

    if (!livekitRoom) {
        return;
    }


    const me =
        players.find(
            player =>
                Number(
                    player.user_id
                ) ===
                Number(
                    currentUserId
                )
        );


    if (!me) {
        return;
    }


    for (
        const remotePlayer of players
    ) {

        if (
            Number(
                remotePlayer.user_id
            ) ===
            Number(
                currentUserId
            )
        ) {

            continue;
        }


        const participant =
            livekitRoom
                .remoteParticipants
                .get(
                    String(
                        remotePlayer.user_id
                    )
                );


        if (!participant) {
            continue;
        }


        applyParticipantVolume(
            participant,
            me,
            remotePlayer
        );
    }
}


// =========================================================
// PARTICIPANT VOLUME
// =========================================================

function applyParticipantVolume(
    participant,
    me,
    remotePlayer
) {

    const distance =
        calculateDistance(
            me,
            remotePlayer
        );


    const volume =
        calculateVolume(
            distance
        );


    try {

        const userId =
            String(
                participant.identity
            );


        const audioElements =
            document.querySelectorAll(
                "audio[data-user-id]"
            );


        audioElements.forEach(
            audio => {

                if (
                    String(
                        audio.dataset.userId
                    ) === userId
                ) {

                    audio.volume =
                        volume;
                }
            }
        );


        if (
            participant.audioTrackPublications
        ) {

            participant
                .audioTrackPublications
                .forEach(
                    publication => {

                        const track =
                            publication.track;


                        if (!track) {
                            return;
                        }


                        if (
                            typeof track.setVolume ===
                            "function"
                        ) {

                            try {

                                track.setVolume(
                                    volume
                                );

                            } catch (_) {}
                        }
                    }
                );
        }

    } catch (error) {

        console.error(
            "[CT Voice] Volume Error:",
            error
        );
    }
}


// =========================================================
// RESET PARTICIPANT AUDIO
// =========================================================

function resetParticipantAudio(
    participant
) {

    if (!participant) {
        return;
    }


    const userId =
        String(
            participant.identity
        );


    document
        .querySelectorAll(
            "audio[data-user-id]"
        )
        .forEach(
            audio => {

                if (
                    String(
                        audio.dataset.userId
                    ) !== userId
                ) {

                    return;
                }


                try {
                    audio.pause();
                } catch (_) {}


                audio.remove();
            }
        );
}


// =========================================================
// DISTANCE
// =========================================================

function calculateDistance(
    a,
    b
) {

    const dx =
        Number(a.x || 0) -
        Number(b.x || 0);


    const dy =
        Number(a.y || 0) -
        Number(b.y || 0);


    const dz =
        Number(a.z || 0) -
        Number(b.z || 0);


    return Math.sqrt(
        dx * dx +
        dy * dy +
        dz * dz
    );
}


// =========================================================
// VOLUME
// =========================================================

function calculateVolume(
    distance
) {

    const MAX_DISTANCE = 80;


    if (
        distance >=
        MAX_DISTANCE
    ) {

        return 0;
    }


    const volume =
        1 -
        (
            distance /
            MAX_DISTANCE
        );


    return Math.max(
        0,
        Math.min(
            1,
            volume
        )
    );
}


// =========================================================
// ACTIVE SPEAKERS
// =========================================================

function handleActiveSpeakers(
    speakers
) {

    if (!Array.isArray(speakers)) {
        return;
    }


    const activeIds =
        new Set(
            speakers.map(
                speaker =>
                    String(
                        speaker.identity
                    )
            )
        );


    const container =
        document.getElementById(
            "playersList"
        );


    if (!container) {
        return;
    }


    const items =
        container.querySelectorAll(
            ".voice-player"
        );


    items.forEach(
        item => {

            const userId =
                item.dataset.userId;


            if (!userId) {
                return;
            }


            if (
                activeIds.has(
                    String(userId)
                )
            ) {

                item.classList.add(
                    "speaking"
                );

            } else {

                item.classList.remove(
                    "speaking"
                );
            }
        }
    );
}


// =========================================================
// SEND VOICE STATE
// =========================================================

async function sendVoiceState(
    speaking = false
) {

    if (!currentUserId) {
        return;
    }


    try {

        await fetchWithTimeout(
            "/voice/state",
            {
                method: "POST",
                headers: {
                    "Content-Type":
                        "application/json"
                },
                body: JSON.stringify({
                    user_id:
                        currentUserId,

                    connected:
                        connectedToVoice,

                    mic_enabled:
                        !isMicrophoneMuted,

                    speaking:
                        Boolean(
                            speaking
                        )
                })
            },
            8000
        );

    } catch (error) {

        console.error(
            "[CT Voice] State Error:",
            error
        );
    }
}


// =========================================================
// INPUT EVENTS
// =========================================================

if (verificationCode) {

    verificationCode.addEventListener(
        "input",
        () => {

            verificationCode.value =
                verificationCode.value
                    .replace(
                        /[^a-zA-Z0-9]/g,
                        ""
                    )
                    .toUpperCase()
                    .slice(
                        0,
                        8
                    );
        }
    );


    verificationCode.addEventListener(
        "keydown",
        event => {

            if (
                event.key ===
                "Enter"
            ) {

                event.preventDefault();

                verifyCode();
            }
        }
    );
}


if (usernameInput) {

    usernameInput.addEventListener(
        "keydown",
        event => {

            if (
                event.key ===
                "Enter"
            ) {

                event.preventDefault();

                requestVerification();
            }
        }
    );
}


// =========================================================
// BUTTON EVENTS
// =========================================================

if (verifyAccountBtn) {

    verifyAccountBtn.addEventListener(
        "click",
        requestVerification
    );
}


if (microphoneYesBtn) {

    microphoneYesBtn.addEventListener(
        "click",
        acceptMicrophone
    );
}


if (microphoneNoBtn) {

    microphoneNoBtn.addEventListener(
        "click",
        declineMicrophone
    );
}


if (verifyCodeBtn) {

    verifyCodeBtn.addEventListener(
        "click",
        verifyCode
    );
}


if (backToMicrophoneBtn) {

    backToMicrophoneBtn.addEventListener(
        "click",
        backToMicrophone
    );
}


if (micToggleBtn) {

    micToggleBtn.addEventListener(
        "click",
        toggleMicrophone
    );
}


if (leaveVoiceBtn) {

    leaveVoiceBtn.addEventListener(
        "click",
        showLeaveConfirmation
    );
}


if (confirmLeaveBtn) {

    confirmLeaveBtn.addEventListener(
        "click",
        confirmLeaveVoice
    );
}


if (cancelLeaveBtn) {

    cancelLeaveBtn.addEventListener(
        "click",
        hideLeaveConfirmation
    );
}


// =========================================================
// MODAL
// =========================================================

const leaveModal =
    document.getElementById(
        "leaveModal"
    );


if (leaveModal) {

    leaveModal.addEventListener(
        "click",
        event => {

            if (
                event.target ===
                leaveModal
            ) {

                hideLeaveConfirmation();
            }
        }
    );
}


// =========================================================
// PAGE UNLOAD
// =========================================================

window.addEventListener(
    "beforeunload",
    () => {

        try {

            if (
                livekitRoom
            ) {

                livekitRoom.disconnect();
            }

        } catch (_) {}
    }
);


// =========================================================
// INITIAL STATE
// =========================================================

hideElement(
    microphoneStep
);

hideElement(
    codeStep
);

hideElement(
    voiceCard
);

hideElement(
    adminCard
);

showElement(
    usernameStep
);


updateMicrophoneButton();


setVoiceStatus(
    "غير متصل بالصوت",
    false
);


updateCurrentStatus();


// =========================================================
// EXPOSE FUNCTIONS
// =========================================================

window.requestVerification =
    requestVerification;

window.acceptMicrophone =
    acceptMicrophone;

window.declineMicrophone =
    declineMicrophone;

window.verifyCode =
    verifyCode;

window.backToMicrophone =
    backToMicrophone;

window.toggleMicrophone =
    toggleMicrophone;

window.showLeaveConfirmation =
    showLeaveConfirmation;

window.hideLeaveConfirmation =
    hideLeaveConfirmation;

window.confirmLeaveVoice =
    confirmLeaveVoice;

window.leaveVoice =
    leaveVoice;


// =========================================================
// READY
// =========================================================

console.log(
    "[CT Voice] voice.js loaded successfully."
);
