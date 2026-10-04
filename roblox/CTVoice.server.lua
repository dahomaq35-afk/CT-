--========================================================
-- CT VOICE - SERVER
--========================================================

local Players = game:GetService("Players")
local HttpService = game:GetService("HttpService")

--========================================================
-- SETTINGS
--========================================================

local API_URL = "https://ct-y99e.onrender.com"

local POSITION_INTERVAL = 1
local STATUS_INTERVAL = 2

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

		return HttpService:JSONDecode(
			result.Body
		)

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
-- ROBLOX UI
--========================================================

local function getGui(player)

	local playerGui =
		player:FindFirstChildOfClass("PlayerGui")

	if not playerGui then
		return nil
	end

	local gui =
		playerGui:FindFirstChild("CTVoiceUI")

	if not gui then

		gui = Instance.new("ScreenGui")

		gui.Name = "CTVoiceUI"

		gui.ResetOnSpawn = false

		gui.IgnoreGuiInset = true

		gui.Parent = playerGui

	end

	return gui
end


local function showMessage(
	player,
	title,
	text
)

	local gui = getGui(player)

	if not gui then
		return
	end

	local frame =
		gui:FindFirstChild("Main")

	if not frame then

		frame = Instance.new("Frame")

		frame.Name = "Main"

		frame.Size =
			UDim2.new(
				0,
				360,
				0,
				150
			)

		frame.Position =
			UDim2.new(
				0.5,
				-180,
				0.08,
				0
			)

		frame.BackgroundColor3 =
			Color3.fromRGB(
				20,
				20,
				25
			)

		frame.BackgroundTransparency =
			0.05

		frame.BorderSizePixel = 0

		frame.Parent = gui


		local corner =
			Instance.new("UICorner")

		corner.CornerRadius =
			UDim.new(
				0,
				12
			)

		corner.Parent = frame


		local titleLabel =
			Instance.new("TextLabel")

		titleLabel.Name =
			"Title"

		titleLabel.Size =
			UDim2.new(
				1,
				-20,
				0,
				35
			)

		titleLabel.Position =
			UDim2.new(
				0,
				10,
				0,
				8
			)

		titleLabel.BackgroundTransparency = 1

		titleLabel.TextColor3 =
			Color3.fromRGB(
				255,
				255,
				255
			)

		titleLabel.TextSize = 22

		titleLabel.Font =
			Enum.Font.GothamBold

		titleLabel.TextXAlignment =
			Enum.TextXAlignment.Center

		titleLabel.Parent = frame


		local messageLabel =
			Instance.new("TextLabel")

		messageLabel.Name =
			"Message"

		messageLabel.Size =
			UDim2.new(
				1,
				-20,
				0,
				85
			)

		messageLabel.Position =
			UDim2.new(
				0,
				10,
				0,
				48
			)

		messageLabel.BackgroundTransparency = 1

		messageLabel.TextColor3 =
			Color3.fromRGB(
				220,
				220,
				220
			)

		messageLabel.TextSize = 18

		messageLabel.Font =
			Enum.Font.Gotham

		messageLabel.TextWrapped = true

		messageLabel.TextXAlignment =
			Enum.TextXAlignment.Center

		messageLabel.TextYAlignment =
			Enum.TextYAlignment.Center

		messageLabel.Parent = frame

	end


	local titleLabel =
		frame:FindFirstChild("Title")

	local messageLabel =
		frame:FindFirstChild("Message")


	if titleLabel then
		titleLabel.Text = title or "CT Voice"
	end

	if messageLabel then
		messageLabel.Text = text or ""
	end

	frame.Visible = true
end


local function hideMessage(player)

	local playerGui =
		player:FindFirstChildOfClass("PlayerGui")

	if not playerGui then
		return
	end

	local gui =
		playerGui:FindFirstChild("CTVoiceUI")

	if not gui then
		return
	end

	local frame =
		gui:FindFirstChild("Main")

	if frame then
		frame.Visible = false
	end
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

	local character =
		player.Character

	if not character then
		return
	end

	local root =
		character:FindFirstChild(
			"HumanoidRootPart"
		)

	if not root then
		return
	end

	local position =
		root.Position

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

	local data =
		request(
			"GET",
			"/roblox/verification/" ..
				tostring(player.UserId)
		)

	if not data then
		return
	end

	local verified =
		data.verified == true

	local code =
		data.code

	local message =
		data.message


	--====================================================
	-- VERIFIED
	--====================================================

	if verified then

		showMessage(
			player,
			"🎙️ CT Voice",
			message or
				"تم التحقق بنجاح. يمكنك استخدام CT Voice من الموقع."
		)

		return
	end


	--====================================================
	-- CODE
	--====================================================

	if code then

		showMessage(
			player,
			"🔐 رمز تحقق CT Voice",
			"رمز التحقق الخاص بك:\n\n" ..
			tostring(code) ..
			"\n\nأدخل الرمز في موقع CT Voice."
		)

		return
	end


	--====================================================
	-- WAITING
	--====================================================

	showMessage(
		player,
		"🎙️ CT Voice",
		message or
			"بانتظار طلب التحقق من موقع CT Voice."
	)
end

--========================================================
-- INITIAL STATE
--========================================================

local function sendInitialState(player)

	showMessage(
		player,
		"🎙️ CT Voice",
		"جاري الاتصال بنظام CT Voice..."
	)

end

--========================================================
-- POSITION LOOP
--========================================================

local function startPositionLoop(player)

	task.spawn(function()

		while player.Parent == Players do

			sendPosition(player)

			task.wait(
				POSITION_INTERVAL
			)

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

			task.wait(
				STATUS_INTERVAL
			)

		end

	end)

end

--========================================================
-- PLAYER ADDED
--========================================================

Players.PlayerAdded:Connect(function(player)

	print(
		"[CT Voice] Player joined:",
		player.Name,
		player.UserId
	)

	-- انتظار PlayerGui
	task.wait(2)

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

for _, player in ipairs(
	Players:GetPlayers()
) do

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
print(
	"Position:",
	POSITION_INTERVAL,
	"second"
)
print(
	"Status:",
	STATUS_INTERVAL,
	"seconds"
)
print("========================================")
