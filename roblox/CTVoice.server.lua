--========================================================
-- CT VOICE - SERVER
--========================================================

local Players = game:GetService("Players")
local HttpService = game:GetService("HttpService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

--========================================================
-- SETTINGS
--========================================================

local API_URL = "https://ct-y99e.onrender.com"

local POSITION_INTERVAL = 1
local STATUS_INTERVAL = 2

--========================================================
-- REMOTE FOLDER
--========================================================

local remoteFolder = ReplicatedStorage:FindFirstChild("CTVoice")

if not remoteFolder then
	remoteFolder = Instance.new("Folder")
	remoteFolder.Name = "CTVoice"
	remoteFolder.Parent = ReplicatedStorage
end

local function getRemote(name, className)

	local remote = remoteFolder:FindFirstChild(name)

	if not remote then
		remote = Instance.new(className)
		remote.Name = name
		remote.Parent = remoteFolder
	end

	return remote
end

local UpdateUI = getRemote("UpdateUI", "RemoteEvent")
local MicAction = getRemote("MicAction", "RemoteEvent")
local LeaveVoice = getRemote("LeaveVoice", "RemoteEvent")

--========================================================
-- HTTP REQUEST
--========================================================

local function request(method, path, body)

	local success, result = pcall(function()

		local options = {
			Url = API_URL .. path,
			Method = method,

			Headers = {
				["Content-Type"] = "application/json"
			}
		}

		if body then
			options.Body = HttpService:JSONEncode(body)
		end

		return HttpService:RequestAsync(options)

	end)

	if not success then

		warn(
			"[CT Voice] HTTP request failed:",
			tostring(result)
		)

		return nil
	end

	if not result.Success then

		warn(
			"[CT Voice] HTTP error:",
			result.StatusCode,
			result.StatusMessage
		)

		return nil
	end

	if not result.Body or result.Body == "" then
		return {}
	end

	local decodeSuccess, data = pcall(function()
		return HttpService:JSONDecode(result.Body)
	end)

	if not decodeSuccess then

		warn(
			"[CT Voice] Invalid JSON from:",
			path
		)

		return nil
	end

	return data
end

--========================================================
-- PLAYER POSITION
--========================================================

local function sendPosition(player)

	if not player then
		return
	end

	if not player.Parent then
		return
	end

	local character = player.Character

	if not character then
		return
	end

	local root = character:FindFirstChild("HumanoidRootPart")

	if not root then
		return
	end

	local position = root.Position

	request(
		"POST",
		"/roblox/player",
		{
			user_id = player.UserId,
			username = player.Name,

			x = position.X,
			y = position.Y,
			z = position.Z
		}
	)

end

--========================================================
-- PLAYER LEAVE
--========================================================

local function notifyPlayerLeft(player)

	if not player then
		return
	end

	request(
		"POST",
		"/roblox/player/leave",
		{
			user_id = player.UserId
		}
	)

end

--========================================================
-- VERIFICATION
--========================================================

local function checkVerification(player)

	if not player then
		return
	end

	if not player.Parent then
		return
	end

	local data = request(
		"GET",
		"/roblox/verification/" .. tostring(player.UserId)
	)

	if not data then
		return
	end

	local verified = data.verified == true

	local code = data.code

	local message = data.message

	if verified then

		UpdateUI:FireClient(
			player,
			{
				type = "verified",

				verified = true,

				code = nil,

				message = message or "تم التحقق بنجاح"
			}
		)

		return
	end

	if code then

		UpdateUI:FireClient(
			player,
			{
				type = "code",

				verified = false,

				code = tostring(code),

				message = message or "أدخل الرمز في الموقع"
			}
		)

		return
	end

	UpdateUI:FireClient(
		player,
		{
			type = "waiting",

			verified = false,

			code = nil,

			message = message or "بانتظار طلب التحقق من الموقع"
		}
	)

end

--========================================================
-- SEND CURRENT STATE
--========================================================

local function sendInitialState(player)

	UpdateUI:FireClient(
		player,
		{
			type = "loading",

			message = "جاري الاتصال بنظام CT Voice..."
		}
	)

end

--========================================================
-- PLAYER TRACKING
--========================================================

local function startPositionLoop(player)

	task.spawn(function()

		while player.Parent == Players do

			sendPosition(player)

			task.wait(POSITION_INTERVAL)

		end

	end)

end

--========================================================
-- VERIFICATION LOOP
--========================================================

local function startVerificationLoop(player)

	task.spawn(function()

		while player.Parent == Players do

			checkVerification(player)

			task.wait(STATUS_INTERVAL)

		end

	end)

end

--========================================================
-- MICROPHONE ACTION
--========================================================

MicAction.OnServerEvent:Connect(function(player, enabled)

	if typeof(enabled) ~= "boolean" then
		return
	end

	local response = request(
		"POST",
		"/voice/state",
		{
			user_id = player.UserId,

			mic_enabled = enabled,

			muted = not enabled
		}
	)

	if response then

		UpdateUI:FireClient(
			player,
			{
				type = "mic",

				enabled = enabled
			}
		)

	end

end)

--========================================================
-- LEAVE VOICE
--========================================================

LeaveVoice.OnServerEvent:Connect(function(player)

	request(
		"POST",
		"/voice/leave",
		{
			user_id = player.UserId
		}
	)

	UpdateUI:FireClient(
		player,
		{
			type = "left",

			message = "تمت مغادرة CT Voice"
		}
	)

end)

--========================================================
-- PLAYER ADDED
--========================================================

Players.PlayerAdded:Connect(function(player)

	print(
		"[CT Voice] Player joined:",
		player.Name,
		player.UserId
	)

	sendInitialState(player)

	startPositionLoop(player)

	startVerificationLoop(player)

end)

--========================================================
-- PLAYER REMOVING
--========================================================

Players.PlayerRemoving:Connect(function(player)

	print(
		"[CT Voice] Player left:",
		player.Name,
		player.UserId
	)

	notifyPlayerLeft(player)

end)

--========================================================
-- EXISTING PLAYERS
--========================================================

for _, player in ipairs(Players:GetPlayers()) do

	sendInitialState(player)

	startPositionLoop(player)

	startVerificationLoop(player)

end

--========================================================
-- START
--========================================================

print("========================================")
print("         CT VOICE SERVER ONLINE")
print("========================================")
print("API:", API_URL)
print("Position:", POSITION_INTERVAL, "second")
print("Status:", STATUS_INTERVAL, "seconds")
print("========================================")
