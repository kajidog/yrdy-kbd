package main

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"fmt"
)

const (
	passphraseSaltSize = 16
	passphraseMaxBytes = 256
)

type passphraseDigest struct {
	salt []byte
	sum  []byte
}

func newPassphraseDigest(passphrase string) (passphraseDigest, error) {
	if err := validatePassphrase(passphrase); err != nil {
		return passphraseDigest{}, err
	}

	salt := make([]byte, passphraseSaltSize)
	if _, err := rand.Read(salt); err != nil {
		return passphraseDigest{}, fmt.Errorf("generate passphrase salt: %w", err)
	}

	sum := hashPassphrase(salt, passphrase)
	return passphraseDigest{salt: salt, sum: sum}, nil
}

func validatePassphrase(passphrase string) error {
	if passphrase == "" {
		return fmt.Errorf("passphrase is required")
	}
	if len([]byte(passphrase)) > passphraseMaxBytes {
		return fmt.Errorf("passphrase must be %d bytes or less", passphraseMaxBytes)
	}
	return nil
}

func (d passphraseDigest) matches(passphrase string) bool {
	if passphrase == "" || len(d.salt) == 0 || len(d.sum) == 0 {
		return false
	}
	sum := hashPassphrase(d.salt, passphrase)
	return subtle.ConstantTimeCompare(d.sum, sum) == 1
}

func hashPassphrase(salt []byte, passphrase string) []byte {
	h := sha256.New()
	h.Write(salt)
	h.Write([]byte(passphrase))
	return h.Sum(nil)
}
