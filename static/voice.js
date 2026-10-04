// =========================================================
// CT VOICE - voice.js
// FIXED AUTH ERRORS VERSION
// =========================================================

let currentUsername = "";
let currentUserId = null;

let livekitRoom = null;
let localAudioTrack = null;

let isMicrophoneMuted = false;
let statusTimer = null;
let playersTimer = null;

let connectedToVoice = false;


// =========================================================
// ELEMENTS
// =========================================================

const verificationCard =
    document.getElementById("verificationCard");

const microphoneCard =
    document.getElementById("microphoneCard");

const codeCard =
    document.getElementById("codeCard");

const voiceCard =
    document.getElementById("voiceCard");

const usernameInput =
    document.getElementById("username");

const verificationCode =
    document.getElementById("verificationCode");

const message =
    document.getElementById("message");

const declineMessage =
    document.getElementById("declineMessage");

const codeMessage =
    document.getElementById("codeMessage");

const voiceMessage =
    document.getElementById("voiceMessage");

const checkButton =
    document.getElementById("checkButton") ||
    document.getElementById("verifyAccountBtn");


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
    if (!element) {
        console.error(
            "[CT Voice] Message element not found:",
            text
        );
        return;
    }

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

        if (!button.dataset.originalText) {

            button.dataset.originalText =
                button.textContent;
        }

        button.disabled = true;

        button.textContent =
            text || "جارٍ التحقق...";

    } else {

        button.disabled = false;

        button.textContent =
            button.dataset.originalText ||
            "تحقق";
    }
}


// =========================================================
// READ SERVER RESPONSE SAFELY
// =========================================================

async function readResponse(response) {

    const raw =
        await response.text();

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

    const username =
        usernameInput
            ? usernameInput.value.trim()
            : "";

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

        const controller =
            new AbortController();

        const timeout =
            setTimeout(
                () => controller.abort(),
                15000
            );

        let response;

        try {

            response =
                await fetch(
                    "/auth/request",
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body: JSON.stringify({
                            username: username
                        }),

                        signal:
                            controller.signal
                    }
                );

        } finally {

            clearTimeout(timeout);
        }


        const data =
            await readResponse(response);


        console.log(
            "[CT Voice] Auth Response:",
            response.status,
            data
        );


        setButtonLoading(
            checkButton,
            false
        );


        // =================================================
        // ACCOUNT NOT FOUND
        // =================================================

        if (
            data.status ===
            "account_not_found"
        ) {

            showMessage(
                message,
                "❌ " +
                (
                    data.message ||
                    "لم يتم العثور على حساب Roblox بهذا الاسم."
                )
            );

            return;
        }


        // =================================================
        // NOT IN GAME
        // =================================================

        if (
            data.status ===
            "not_in_game"
        ) {

            showMessage(
                message,
                "⚠️ " +
                (
                    data.message ||
                    "الحساب موجود، لكن يجب أن تكون داخل سيرفر CT."
                )
            );

            return;
        }


        // =================================================
        // DECLINED COOLDOWN
        // =================================================

        if (
            data.status ===
            "declined_cooldown"
        ) {

            const minutes =
                Math.max(
                    1,
                    Math.ceil(
                        Number(
                            data.remaining || 300
                        ) / 60
                    )
                );

            showMessage(
                message,
                `⏳ رفضت تفعيل المايك. حاول بعد ${minutes} دقيقة.`
            );

            return;
        }


        // =================================================
        // INVALID USERNAME
        // =================================================

        if (
            data.status ===
            "invalid_username"
        ) {

            showMessage(
                message,
                "❌ " +
                (
                    data.message ||
                    "اسم Roblox غير صالح."
                )
            );

            return;
        }


        // =================================================
        // SUCCESS
        // =================================================

        if (
            data.success === true &&
            data.status === "found"
        ) {

            currentUsername =
                data.username ||
                username;

            currentUserId =
                Number(data.user_id);


            hideElement(
                verificationCard
            );

            showElement(
                microphoneCard
            );


            clearMessage(
                message
            );

            clearMessage(
                declineMessage
            );

            return;
        }


        // =================================================
        // ANY OTHER SERVER MESSAGE
        // =================================================

        showMessage(
            message,
            data.message ||
            data.detail ||
            `حدث خطأ من السيرفر. HTTP ${response.status}`
        );

    } catch (error) {

        setButtonLoading(
            checkButton,
            false
        );


        if (
            error &&
            error.name === "AbortError"
        ) {

            showMessage(
                message,
                "⏱️ السيرفر تأخر في الرد. حاول مرة أخرى."
            );

        } else {

            showMessage(
                message,
                "❌ تعذر الاتصال بالسيرفر. حاول مرة أخرى."
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

    clearMessage(
        declineMessage
    );


    if (!currentUsername) {

        showMessage(
            declineMessage,
            "انتهت جلسة التحقق. أعد المحاولة."
        );

        return;
    }


    try {

        const response =
            await fetch(
                "/auth/request",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        username:
                            currentUsername
                    })
                }
            );


        const data =
            await readResponse(response);


        console.log(
            "[CT Voice] Code Request:",
            response.status,
            data
        );


        if (
            !response.ok ||
            !data.success
        ) {

            showMessage(
                declineMessage,
                data.message ||
                data.detail ||
                "تعذر إنشاء رمز التحقق."
            );

            return;
        }


        currentUserId =
            Number(data.user_id);

        currentUsername =
            data.username ||
            currentUsername;


        hideElement(
            microphoneCard
        );

        showElement(
            codeCard
        );


        if (verificationCode) {

            verificationCode.value = "";

            verificationCode.focus();
        }


        clearMessage(
            codeMessage
        );

    } catch (error) {

        showMessage(
            declineMessage,
            "❌ تعذر الاتصال بالسيرفر."
        );

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

    clearMessage(
        declineMessage
    );


    if (!currentUsername) {

        hideElement(
            microphoneCard
        );

        showElement(
            verificationCard
        );

        return;
    }


    try {

        await fetch(
            "/auth/decline",
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({
                    username:
                        currentUsername
                })
            }
        );

    } catch (error) {

        console.error(
            "[CT Voice] Decline Error:",
            error
        );
    }


    hideElement(
        microphoneCard
    );

    currentUsername = "";
    currentUserId = null;

    showElement(
        verificationCard
    );
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


    clearMessage(
        codeMessage
    );


    if (
        !currentUsername ||
        !currentUserId
    ) {

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

        const response =
            await fetch(
                "/auth/verify",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        username:
                            currentUsername,

                        code:
                            code
                    })
                }
            );


        const data =
            await readResponse(response);


        console.log(
            "[CT Voice] Verify Response:",
            response.status,
            data
        );


        // =================================================
        // WRONG CODE
        // =================================================

        if (
            data.status ===
            "wrong_code"
        ) {

            showMessage(
                codeMessage,
                `❌ ${data.message || "رمز التحقق غير صحيح."} المحاولات المتبقية: ${data.remaining_attempts}`
            );

            if (verificationCode) {
                verificationCode.select();
            }

            return;
        }


        // =================================================
        // EXPIRED
        // =================================================

        if (
            data.status ===
            "expired"
        ) {

            showMessage(
                codeMessage,
                "⏳ " +
                (
                    data.message ||
                    "انتهت صلاحية الرمز."
                )
            );

            return;
        }


        // =================================================
        // TOO MANY ATTEMPTS
        // =================================================

        if (
            data.status ===
            "too_many_attempts"
        ) {

            showMessage(
                codeMessage,
                "❌ " +
                (
                    data.message ||
                    "تم تجاوز عدد المحاولات."
                )
            );

            return;
        }


        // =================================================
        // PLAYER LEFT
        // =================================================

        if (
            data.status ===
            "not_in_game"
        ) {

            showMessage(
                codeMessage,
                "⚠️ " +
                (
                    data.message ||
                    "خرجت من سيرفر CT."
                )
            );

            return;
        }


        // =================================================
        // SUCCESS
        // =================================================

        if (
            data.success === true &&
            data.status === "verified"
        ) {

            currentUserId =
                Number(data.user_id);

            currentUsername =
                data.username ||
                currentUsername;


            hideElement(
                codeCard
            );

            showElement(
                voiceCard
            );


            const voiceUsername =
                document.getElementById(
                    "voiceUsername"
                );


            if (voiceUsername) {

                voiceUsername.textContent =
                    currentUsername;
            }


            await connectToVoice();

            startVerificationStatus();

            startPlayersRefresh();

            return;
        }


        showMessage(
            codeMessage,
            data.message ||
            data.detail ||
            "رمز التحقق غير صحيح."
        );

    } catch (error) {

        showMessage(
            codeMessage,
            "❌ تعذر الاتصال بالسيرفر."
        );

        console.error(
            "[CT Voice] Verify Error:",
            error
        );
    }
}


// =========================================================
// CONNECT TO LIVEKIT
// =========================================================

async function connectToVoice() {

    clearMessage(
        voiceMessage
    );


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

        const response =
            await fetch(
                "/voice/token",
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
                }
            );


        const data =
            await readResponse(response);


        if (
            !response.ok ||
            !data.success
        ) {

            showMessage(
                voiceMessage,
                data.message ||
                data.detail ||
                "تعذر إنشاء اتصال الصوت."
            );

            return;
        }


        livekitRoom =
            new LivekitClient.Room({
                adaptiveStream: true,
                dynacast: true
            });


        livekitRoom.on(
            LivekitClient.RoomEvent.Disconnected,
            () => {

                localAudioTrack = null;

                connectedToVoice = false;

                setVoiceStatus(
                    "غير متصل بالصوت",
                    false
                );
            }
        );


        livekitRoom.on(
            LivekitClient.RoomEvent.ActiveSpeakersChanged,
            (speakers) => {

                handleActiveSpeakers(
                    speakers
                );

                const myIdentity =
                    String(currentUserId);

                const amISpeaking =
                    speakers.some(
                        speaker =>
                            String(
                                speaker.identity
                            ) === myIdentity
                    );

                sendVoiceState(
                    amISpeaking
                );
            }
        );


        livekitRoom.on(
            LivekitClient.RoomEvent.ParticipantConnected,
            participant => {

                console.log(
                    "[CT Voice] Player joined:",
                    participant.identity
                );
            }
        );


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


                    document.body.appendChild(
                        element
                    );


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


        livekitRoom.on(
            LivekitClient.RoomEvent.TrackUnsubscribed,
            (
                track
            ) => {

                try {
                    track.detach();
                } catch (_) {}
            }
        );


        await livekitRoom.connect(
            data.url,
            data.token
        );


        connectedToVoice = true;


        await enableMicrophone();


        setVoiceStatus(
            "متصل بالصوت",
            true
        );

    } catch (error) {

        console.error(
            "[CT Voice] LiveKit Error:",
            error
        );

        connectedToVoice = false;

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

        await livekitRoom
            .localParticipant
            .setMicrophoneEnabled(true);


        isMicrophoneMuted = false;


        const publications =
            livekitRoom
                .localParticipant
                .audioTrackPublications;


        if (publications) {

            publications.forEach(
                publication => {

                    if (publication.track) {

                        localAudioTrack =
                            publication.track;
                    }
                }
            );
        }


        updateMicrophoneButton();

        sendVoiceState();

    } catch (error) {

        console.error(
            "[CT Voice] Enable Mic Error:",
            error
        );

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

        sendVoiceState();

    } catch (error) {

        console.error(
            "[CT Voice] Toggle Mic Error:",
            error
        );

        showMessage(
            voiceMessage,
            "تعذر تغيير حالة المايك."
        );
    }
}


// =========================================================
// MICROPHONE BUTTON
// =========================================================

function updateMicrophoneButton() {

    const micIcon =
        document.getElementById(
            "micIcon"
        );

    const micText =
        document.getElementById(
            "micText"
        );

    const micButton =
        document.getElementById(
            "micButton"
        );


    if (
        !micIcon ||
        !micText ||
        !micButton
    ) {
        return;
    }


    if (isMicrophoneMuted) {

        micIcon.textContent =
            "🔇";

        micText.textContent =
            "فتح المايك";

        micButton.classList.add(
            "muted"
        );

    } else {

        micIcon.textContent =
            "🎙️";

        micText.textContent =
            "كتم المايك";

        micButton.classList.remove(
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
            dot.classList.add("connected");
        } else {
            dot.classList.remove("connected");
        }
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


    if (currentUserId) {

        try {

            await fetch(
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
                }
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

    isMicrophoneMuted = false;

    currentUsername = "";
    currentUserId = null;


    if (verificationCode) {
        verificationCode.value = "";
    }


    hideElement(voiceCard);
    hideElement(codeCard);
    hideElement(microphoneCard);

    showElement(verificationCard);


    if (usernameInput) {
        usernameInput.value = "";
    }


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

        const response =
            await fetch(
                `/auth/status/${currentUserId}`
            );


        const data =
            await readResponse(response);


        if (!data.verified) {

            if (livekitRoom) {

                try {
                    await livekitRoom.disconnect();
                } catch (_) {}
            }


            livekitRoom = null;

            connectedToVoice = false;


            stopVerificationStatus();
            stopPlayersRefresh();


            hideElement(voiceCard);

            showElement(
                verificationCard
            );


            currentUsername = "";
            currentUserId = null;


            showMessage(
                message,
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

    if (!currentUserId) return;


    try {

        const response =
            await fetch(
                `/voice/players/${currentUserId}`
            );


        if (!response.ok) return;


        const data =
            await readResponse(response);


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


    if (!container) return;


    container.innerHTML = "";


    for (
        const player of players
    ) {

        if (
            Number(player.user_id) ===
            Number(currentUserId)
        ) {
            continue;
        }


        const item =
            document.createElement(
                "div"
            );


        item.className =
            "voice-player";


        item.dataset.userId =
            String(player.user_id);


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

        } else if (player.speaking) {

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
// PROXIMITY VOICE
// =========================================================

function applyProximityVolume(players) {

    if (!livekitRoom) return;


    const me =
        players.find(
            player =>
                Number(player.user_id) ===
                Number(currentUserId)
        );


    if (!me) return;


    for (
        const remotePlayer of players
    ) {

        if (
            Number(remotePlayer.user_id) ===
            Number(currentUserId)
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


        if (!participant) continue;


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

        participant
            .audioTrackPublications
            .forEach(
                publication => {

                    const track =
                        publication.track;


                    if (!track) return;


                    if (
                        typeof track.setVolume ===
                        "function"
                    ) {

                        track.setVolume(
                            volume
                        );

                    } else {

                        const audioElements =
                            document.querySelectorAll(
                                `audio[data-user-id="${CSS.escape(
                                    String(
                                        participant.identity
                                    )
                                )}"]`
                            );


                        audioElements.forEach(
                            audio => {

                                audio.volume =
                                    volume;
                            }
                        );
                    }
                }
            );

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

    const userId =
        String(
            participant.identity
        );


    document
        .querySelectorAll(
            `audio[data-user-id="${CSS.escape(userId)}"]`
        )
        .forEach(
            audio => {

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

function calculateDistance(a, b) {

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

function calculateVolume(distance) {

    const MAX_DISTANCE = 80;


    if (
        distance >= MAX_DISTANCE
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


    if (!container) return;


    const items =
        container.querySelectorAll(
            ".voice-player"
        );


    items.forEach(
        item => {

            const userId =
                item.dataset.userId;


            if (!userId) return;


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

    if (!currentUserId) return;


    try {

        await fetch(
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
                        Boolean(speaking)
                })
            }
        );

    } catch (error) {

        console.error(
            "[CT Voice] State Error:",
            error
        );
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
                event.key === "Enter"
            ) {

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
        event => {

            if (
                event.key === "Enter"
            ) {

                requestVerification();
            }
        }
    );
}


// =========================================================
// CLOSE MODAL
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
// INITIAL STATE
// =========================================================

updateMicrophoneButton();

setVoiceStatus(
    "غير متصل بالصوت",
    false
);


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
