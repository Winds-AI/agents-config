package main

import (
	"os"

	"agent-api/internal/agentapi"
)

func main() {
	os.Exit(agentapi.Run(os.Args[1:]))
}
