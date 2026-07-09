package model

import (
	"encoding/json"
	"fmt"
	"io"
)

// StringMap backs the StringMap GraphQL scalar: a flat string-to-string map
// used for KVS signaling query parameters.
type StringMap map[string]string

func (m StringMap) MarshalGQL(w io.Writer) {
	data, err := json.Marshal(map[string]string(m))
	if err != nil {
		panic(fmt.Errorf("marshal StringMap: %w", err))
	}
	_, _ = w.Write(data)
}

func (m *StringMap) UnmarshalGQL(v any) error {
	switch value := v.(type) {
	case nil:
		*m = nil
		return nil
	case map[string]string:
		*m = value
		return nil
	case map[string]any:
		out := make(map[string]string, len(value))
		for key, item := range value {
			str, ok := item.(string)
			if !ok {
				return fmt.Errorf("StringMap value for %q must be a string", key)
			}
			out[key] = str
		}
		*m = out
		return nil
	default:
		return fmt.Errorf("StringMap must be a map of strings, got %T", v)
	}
}
