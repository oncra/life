//go:build windows

package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"
)

// joinWiFi adds a WLAN profile for the network and connects with netsh, which every Windows has. The profile file
// holds the password in plain text, so it is deleted as soon as netsh has read it.
func joinWiFi(ctx context.Context, ssid, password string) error {
	if strings.Contains(ssid, `"`) {
		return errors.New("netsh cannot take a WiFi name with a double quote in it")
	}
	f, err := os.CreateTemp("", "life-wlan-*.xml")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	_, err = f.Write(wlanProfile(ssid, password))
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	out, err := netsh(ctx, `wlan add profile filename="`+f.Name()+`" user=current`)
	os.Remove(f.Name())
	if err != nil {
		return fmt.Errorf("netsh could not add the WiFi: %s", out)
	}
	if out, err := netsh(ctx, `wlan connect name="`+ssid+`"`); err != nil {
		return fmt.Errorf("netsh could not connect: %s", out)
	}
	return nil
}

// netsh runs netsh with this command line exactly as written: netsh parses its own quotes, which Go's quoting of
// separate arguments would break for a path with a space in it.
func netsh(ctx context.Context, args string) (string, error) {
	cmd := exec.CommandContext(ctx, "netsh")
	cmd.SysProcAttr = &syscall.SysProcAttr{CmdLine: "netsh " + args, HideWindow: true}
	out, err := cmd.CombinedOutput()
	s := strings.TrimSpace(string(out))
	if err != nil && s == "" {
		s = err.Error()
	}
	return s, err
}

func openBrowser(u string) error {
	cmd := exec.Command("rundll32", "url.dll,FileProtocolHandler", u)
	if err := cmd.Start(); err != nil {
		return err
	}
	go cmd.Wait()
	return nil
}

func computerName() string { return hostName() }
