//go:build darwin

package main

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// joinWiFi joins the network with networksetup, which every Mac has. It takes the password only on its command
// line, so the password shows in the process list for the second the join takes; it is kept out of every message.
func joinWiFi(ctx context.Context, ssid, password string) error {
	out, err := exec.CommandContext(ctx, "networksetup", "-listallhardwareports").Output()
	if err != nil {
		return fmt.Errorf("networksetup cannot list the network ports (%v)", err)
	}
	dev := wifiDevice(string(out))
	if dev == "" {
		return errors.New("this Mac has no Wi-Fi port")
	}
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	out, err = exec.CommandContext(ctx, "networksetup", "-setairportnetwork", dev, ssid, password).CombinedOutput()
	msg := strings.TrimSpace(strings.ReplaceAll(string(out), password, "********"))
	if err != nil || joinFailed(msg) {
		if msg == "" {
			msg = err.Error()
		}
		return errors.New(msg)
	}
	return nil
}

func openBrowser(u string) error {
	cmd := exec.Command("open", u)
	if err := cmd.Start(); err != nil {
		return err
	}
	go cmd.Wait()
	return nil
}

// computerName is the Mac's name as Sharing in System Settings shows it.
func computerName() string {
	if out, err := exec.Command("scutil", "--get", "ComputerName").Output(); err == nil {
		if s := strings.TrimSpace(string(out)); s != "" {
			return s
		}
	}
	return hostName()
}
