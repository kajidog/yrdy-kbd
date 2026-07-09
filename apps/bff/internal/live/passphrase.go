package live

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

// PassphraseDigest holds a salted hash of a live's passphrase. A zero value
// means the live has no passphrase and anyone with the link may watch.
type PassphraseDigest struct {
	salt []byte
	sum  []byte
}

func NewPassphraseDigest(passphrase string) (PassphraseDigest, error) {
	if passphrase == "" {
		return PassphraseDigest{}, nil
	}
	if len([]byte(passphrase)) > passphraseMaxBytes {
		return PassphraseDigest{}, fmt.Errorf("passphrase must be %d bytes or less", passphraseMaxBytes)
	}

	salt := make([]byte, passphraseSaltSize)
	if _, err := rand.Read(salt); err != nil {
		return PassphraseDigest{}, fmt.Errorf("generate passphrase salt: %w", err)
	}

	sum := hashPassphrase(salt, passphrase)
	return PassphraseDigest{salt: salt, sum: sum}, nil
}

func (d PassphraseDigest) IsSet() bool {
	return len(d.salt) > 0 && len(d.sum) > 0
}

func (d PassphraseDigest) Matches(passphrase string) bool {
	if !d.IsSet() {
		return true
	}
	if passphrase == "" {
		return false
	}
	sum := hashPassphrase(d.salt, passphrase)
	return subtle.ConstantTimeCompare(d.sum, sum) == 1
}

func (d PassphraseDigest) encode() (saltHex, sumHex string) {
	return hex.EncodeToString(d.salt), hex.EncodeToString(d.sum)
}

func decodePassphraseDigest(saltHex, sumHex string) (PassphraseDigest, error) {
	if saltHex == "" && sumHex == "" {
		return PassphraseDigest{}, nil
	}
	salt, err := hex.DecodeString(saltHex)
	if err != nil {
		return PassphraseDigest{}, fmt.Errorf("decode passphrase salt: %w", err)
	}
	sum, err := hex.DecodeString(sumHex)
	if err != nil {
		return PassphraseDigest{}, fmt.Errorf("decode passphrase sum: %w", err)
	}
	return PassphraseDigest{salt: salt, sum: sum}, nil
}

func hashPassphrase(salt []byte, passphrase string) []byte {
	h := sha256.New()
	h.Write(salt)
	h.Write([]byte(passphrase))
	return h.Sum(nil)
}
