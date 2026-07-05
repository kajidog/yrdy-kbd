package main

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
)

const (
	passphraseSaltSize = 16
	passphraseMaxBytes = 256
)

// passphraseDigest holds a salted hash of a live's passphrase. A zero value
// means the live has no passphrase and anyone with the link may watch.
type passphraseDigest struct {
	salt []byte
	sum  []byte
}

func newPassphraseDigest(passphrase string) (passphraseDigest, error) {
	if passphrase == "" {
		return passphraseDigest{}, nil
	}
	if len([]byte(passphrase)) > passphraseMaxBytes {
		return passphraseDigest{}, fmt.Errorf("passphrase must be %d bytes or less", passphraseMaxBytes)
	}

	salt := make([]byte, passphraseSaltSize)
	if _, err := rand.Read(salt); err != nil {
		return passphraseDigest{}, fmt.Errorf("generate passphrase salt: %w", err)
	}

	sum := hashPassphrase(salt, passphrase)
	return passphraseDigest{salt: salt, sum: sum}, nil
}

func (d passphraseDigest) isSet() bool {
	return len(d.salt) > 0 && len(d.sum) > 0
}

func (d passphraseDigest) matches(passphrase string) bool {
	if !d.isSet() {
		return true
	}
	if passphrase == "" {
		return false
	}
	sum := hashPassphrase(d.salt, passphrase)
	return subtle.ConstantTimeCompare(d.sum, sum) == 1
}

func (d passphraseDigest) encode() (saltHex, sumHex string) {
	return hex.EncodeToString(d.salt), hex.EncodeToString(d.sum)
}

func decodePassphraseDigest(saltHex, sumHex string) (passphraseDigest, error) {
	if saltHex == "" && sumHex == "" {
		return passphraseDigest{}, nil
	}
	salt, err := hex.DecodeString(saltHex)
	if err != nil {
		return passphraseDigest{}, fmt.Errorf("decode passphrase salt: %w", err)
	}
	sum, err := hex.DecodeString(sumHex)
	if err != nil {
		return passphraseDigest{}, fmt.Errorf("decode passphrase sum: %w", err)
	}
	return passphraseDigest{salt: salt, sum: sum}, nil
}

func hashPassphrase(salt []byte, passphrase string) []byte {
	h := sha256.New()
	h.Write(salt)
	h.Write([]byte(passphrase))
	return h.Sum(nil)
}
