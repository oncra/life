//go:build !darwin && !windows

package main

import (
	"context"
	"os/exec"
)

// joinWiFi is left to the visitor on other systems: the page asks to join by hand.
func joinWiFi(ctx context.Context, ssid, password string) error { return errByHand }

func openBrowser(u string) error {
	cmd := exec.Command("xdg-open", u)
	if err := cmd.Start(); err != nil {
		return err
	}
	go cmd.Wait()
	return nil
}

func computerName() string { return hostName() }
