package main

import (
	"fmt"
	"os"
)

func main() {
	err := RunAPI("config.toml", os.Args[1:])
	if err != nil {
		msg := ExitMessage(err)
		if msg != "" {
			fmt.Fprintln(os.Stderr, msg)
		}
		os.Exit(ExitCode(err))
	}
	os.Exit(ExitSuccess)
}
