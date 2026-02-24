package agentapi

import "fmt"

type AppError struct {
	Code         string
	Message      string
	SuggestedFix string
}

func (e *AppError) Error() string {
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

func NewAppError(code, message string) *AppError {
	return &AppError{
		Code:    code,
		Message: message,
	}
}
