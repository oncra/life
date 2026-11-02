package main

import (
	"encoding/hex"
	"encoding/xml"
	"errors"
	"strings"
)

// Joining the node's WiFi. The node opens it only during a visit, named like life-x7k2qp, with a WPA2 password the
// owner sees on the node's page. Where the app cannot join a network itself, the visitor joins by hand and says so.

var errByHand = errors.New("this app cannot join a WiFi on this system")

// validWiFi checks a WiFi name and WPA2 password before they reach a system command.
func validWiFi(ssid, password string) error {
	switch {
	case ssid == "":
		return errors.New("enter the WiFi name")
	case len(ssid) > 32:
		return errors.New("a WiFi name is at most 32 characters")
	case strings.IndexFunc(ssid, func(r rune) bool { return r < 0x20 || r == 0x7f }) >= 0:
		return errors.New("the WiFi name has a character that cannot be typed")
	case password == "":
		return errors.New("enter the WiFi password; it is on the node's page")
	case len(password) < 8 || len(password) > 63:
		return errors.New("a WPA2 password has 8 to 63 characters")
	case strings.IndexFunc(password, func(r rune) bool { return r < 0x20 || r > 0x7e }) >= 0:
		return errors.New("a WPA2 password has only letters, digits and the punctuation on a keyboard")
	}
	return nil
}

// wifiDevice finds the Wi-Fi interface (en0 on most Macs) in the output of networksetup -listallhardwareports.
func wifiDevice(out string) string {
	wifi := false
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(line, "Hardware Port:"):
			port := strings.TrimSpace(strings.TrimPrefix(line, "Hardware Port:"))
			wifi = port == "Wi-Fi" || port == "AirPort"
		case wifi && strings.HasPrefix(line, "Device:"):
			return strings.TrimSpace(strings.TrimPrefix(line, "Device:"))
		}
	}
	return ""
}

// joinFailed reads networksetup's answer to -setairportnetwork, which says that a join failed but still exits 0.
func joinFailed(out string) bool {
	m := strings.ToLower(out)
	for _, s := range []string{"error", "fail", "could not", "not find", "unable"} {
		if strings.Contains(m, s) {
			return true
		}
	}
	return false
}

// wlanProfile is a Windows WLAN profile for a WPA2-Personal network with AES, the key given as its passphrase.
func wlanProfile(ssid, password string) []byte {
	esc := func(s string) string {
		var b strings.Builder
		xml.EscapeText(&b, []byte(s))
		return b.String()
	}
	return []byte(`<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
	<name>` + esc(ssid) + `</name>
	<SSIDConfig>
		<SSID>
			<hex>` + strings.ToUpper(hex.EncodeToString([]byte(ssid))) + `</hex>
			<name>` + esc(ssid) + `</name>
		</SSID>
	</SSIDConfig>
	<connectionType>ESS</connectionType>
	<connectionMode>manual</connectionMode>
	<MSM>
		<security>
			<authEncryption>
				<authentication>WPA2PSK</authentication>
				<encryption>AES</encryption>
				<useOneX>false</useOneX>
			</authEncryption>
			<sharedKey>
				<keyType>passPhrase</keyType>
				<protected>false</protected>
				<keyMaterial>` + esc(password) + `</keyMaterial>
			</sharedKey>
		</security>
	</MSM>
</WLANProfile>
`)
}
