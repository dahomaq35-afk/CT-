--=========================================================
-- CT VOICE - ROBLOX SERVER SCRIPT
--=========================================================
local Players = game:GetService("Players")
local HttpService = game:GetService("HttpService")
--=========================================================
-- SETTINGS
--=========================================================
local API_URL = "https://YOUR-CT-VOICE-DOMAIN.com"
local POSITION_UPDATE_SECONDS = 30
local STATUS_CHECK_SECONDS = 5
--=========================================================
-- STATE
--=========================================================
local running = true
--=========================================================
-- HTTP
--=========================================================
local function request(method, url, body)
	local success, result = pcall(function()
		local options = {
			Url = url,
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
		warn("[CT Voice] HTTP Error:", result)
		return nil
	end
	if not result.Success then
		warn(
			"[CT Voice] Server Error:",
			result.StatusCode,
			result.StatusMessage
		)
		return nil
	end
	local ok, data = pcall(function()
		return HttpService:JSONDecode(result.Body)
	end)
	if not ok then
		return nil
	end
	return data
end
--=========================================================
-- SEND PLAYER POSITION
--=========================================================
local function sendPlayerPosition(player)
	if not player.Character then
		return
	end
	local root =
		player.Character:FindFirstChild("HumanoidRootPart")
	if not root then
		return
	end
	local position = root.Position
	request(
		"POST",
		API_URL .. "/roblox/player",
		{
			user_id = player.UserId,
			username = player.Name,
			x = position.X,
			y = position.Y,
			z = position.Z
		}
	)
end
--=========================================================
-- PLAYER JOIN
--=========================================================
Players.PlayerAdded:Connect(function(player)
	print(
		"[CT Voice] Player joined:",
		player.Name,
		player.UserId
	)
	task.spawn(function()
		while running and player.Parent do
			sendPlayerPosition(player)
			task.wait(POSITION_UPDATE_SECONDS)
		end
	end)
end)
--=========================================================
-- PLAYER LEAVE
--=========================================================
Players.PlayerRemoving:Connect(function(player)
	print(
		"[CT Voice] Player left:",
		player.Name
	)
	-- إزالة اللاعب من قائمة الموقع
	request(
		"POST",
		API_URL .. "/roblox/player/leave",
		{
			user_id = player.UserId
		}
	)
end)
--=========================================================
-- EXISTING PLAYERS
--=========================================================
for _, player in ipairs(Players:GetPlayers()) do
	task.spawn(function()
		while running and player.Parent do
			sendPlayerPosition(player)
			task.wait(POSITION_UPDATE_SECONDS)
		end
	end)
end
--=========================================================
-- STARTUP
--=========================================================
print("======================================")
print("        CT VOICE SYSTEM ONLINE")
print("======================================")
print("Position update: 30 seconds")
print("API:", API_URL)
print("======================================")
