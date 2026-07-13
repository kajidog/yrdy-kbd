// Package live holds the live catalog: the Live domain type, its passphrase
// handling, and the JSON-file-backed store.
package live

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type Status string

const (
	StatusCreated Status = "created"
	StatusLive    Status = "live"
	StatusEnded   Status = "ended"
)

type Live struct {
	ID          string
	OwnerID     string
	OwnerName   string
	Title       string
	Public      bool
	Record      bool
	Status      Status
	ChannelName string
	ChannelARN  string
	StreamARN   string
	CreatedAt   time.Time
	StartedAt   *time.Time
	EndedAt     *time.Time

	// Passphrase is a salted hash; the zero value means the live is open.
	Passphrase PassphraseDigest
}

func (l Live) HasPassphrase() bool {
	return l.Passphrase.IsSet()
}

// WatchableBy reports whether a user may watch this live. The owner always
// may; everyone else must present the passphrase when one is set.
func (l Live) WatchableBy(userID, passphrase string) bool {
	if userID == l.OwnerID {
		return true
	}
	return l.Passphrase.Matches(passphrase)
}

// HasRecording reports whether there is (or is being written) archived media
// that can be played back over HLS.
func (l Live) HasRecording() bool {
	return l.Record && l.StreamARN != "" && l.StartedAt != nil
}

// Store keeps lives in memory and mirrors every change to a JSON file so
// past broadcasts survive restarts. An empty path keeps the store in memory
// only (used by tests).
type Store struct {
	mu    sync.RWMutex
	path  string
	lives map[string]Live
}

func NewStore(path string) (*Store, error) {
	store := &Store{path: path, lives: make(map[string]Live)}
	if path == "" {
		return store, nil
	}
	if err := store.load(); err != nil {
		return nil, err
	}
	return store, nil
}

func (s *Store) Put(live Live) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lives[live.ID] = live
	return s.save()
}

func (s *Store) Get(liveID string) (Live, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	live, ok := s.lives[liveID]
	return live, ok
}

// Update applies fn to the stored live under the write lock and persists the
// result. It returns the updated live.
func (s *Store) Update(liveID string, fn func(*Live)) (Live, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	live, ok := s.lives[liveID]
	if !ok {
		return Live{}, fmt.Errorf("live %s not found", liveID)
	}
	fn(&live)
	s.lives[liveID] = live
	if err := s.save(); err != nil {
		return Live{}, err
	}
	return live, nil
}

func (s *Store) ListByOwner(ownerID string) []Live {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var lives []Live
	for _, live := range s.lives {
		if live.OwnerID == ownerID {
			lives = append(lives, live)
		}
	}
	sort.Slice(lives, func(i, j int) bool {
		return lives[i].CreatedAt.After(lives[j].CreatedAt)
	})
	return lives
}

// SearchPublic returns public lives that are either on air or have a
// recording, filtered by a case-insensitive match on title or owner name.
func (s *Store) SearchPublic(query string) []Live {
	needle := strings.ToLower(strings.TrimSpace(query))

	s.mu.RLock()
	defer s.mu.RUnlock()

	var lives []Live
	for _, live := range s.lives {
		if !live.Public {
			continue
		}
		if live.Status != StatusLive && !(live.Status == StatusEnded && live.HasRecording()) {
			continue
		}
		if needle != "" &&
			!strings.Contains(strings.ToLower(live.Title), needle) &&
			!strings.Contains(strings.ToLower(live.OwnerName), needle) {
			continue
		}
		lives = append(lives, live)
	}

	sort.Slice(lives, func(i, j int) bool {
		a, b := lives[i], lives[j]
		if (a.Status == StatusLive) != (b.Status == StatusLive) {
			return a.Status == StatusLive
		}
		return timeOrCreated(a).After(timeOrCreated(b))
	})
	return lives
}

func timeOrCreated(live Live) time.Time {
	if live.StartedAt != nil {
		return *live.StartedAt
	}
	return live.CreatedAt
}

type persistedLive struct {
	ID             string     `json:"id"`
	OwnerID        string     `json:"ownerId"`
	OwnerName      string     `json:"ownerName"`
	Title          string     `json:"title"`
	Public         bool       `json:"public"`
	Record         bool       `json:"record"`
	Status         Status     `json:"status"`
	ChannelName    string     `json:"channelName"`
	ChannelARN     string     `json:"channelArn"`
	StreamARN      string     `json:"streamArn,omitempty"`
	CreatedAt      time.Time  `json:"createdAt"`
	StartedAt      *time.Time `json:"startedAt,omitempty"`
	EndedAt        *time.Time `json:"endedAt,omitempty"`
	PassphraseSalt string     `json:"passphraseSalt,omitempty"`
	PassphraseSum  string     `json:"passphraseSum,omitempty"`
}

type persistedStore struct {
	Lives []persistedLive `json:"lives"`
}

func (s *Store) load() error {
	data, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read live store: %w", err)
	}

	var stored persistedStore
	if err := json.Unmarshal(data, &stored); err != nil {
		return fmt.Errorf("parse live store %s: %w", s.path, err)
	}

	for _, p := range stored.Lives {
		digest, err := decodePassphraseDigest(p.PassphraseSalt, p.PassphraseSum)
		if err != nil {
			return fmt.Errorf("live %s: %w", p.ID, err)
		}
		live := Live{
			ID:          p.ID,
			OwnerID:     p.OwnerID,
			OwnerName:   p.OwnerName,
			Title:       p.Title,
			Public:      p.Public,
			Record:      p.Record,
			Status:      p.Status,
			ChannelName: p.ChannelName,
			ChannelARN:  p.ChannelARN,
			StreamARN:   p.StreamARN,
			CreatedAt:   p.CreatedAt,
			StartedAt:   p.StartedAt,
			EndedAt:     p.EndedAt,
			Passphrase:  digest,
		}
		// A broadcast interrupted by a BFF restart can never be resumed, so
		// surface it as ended instead of a stale "live".
		if live.Status == StatusLive {
			live.Status = StatusEnded
			if live.EndedAt == nil {
				now := time.Now().UTC()
				live.EndedAt = &now
			}
		}
		s.lives[live.ID] = live
	}
	return nil
}

// save writes the store to disk. Callers must hold the write lock.
func (s *Store) save() error {
	if s.path == "" {
		return nil
	}

	stored := persistedStore{Lives: make([]persistedLive, 0, len(s.lives))}
	for _, live := range s.lives {
		saltHex, sumHex := live.Passphrase.encode()
		stored.Lives = append(stored.Lives, persistedLive{
			ID:             live.ID,
			OwnerID:        live.OwnerID,
			OwnerName:      live.OwnerName,
			Title:          live.Title,
			Public:         live.Public,
			Record:         live.Record,
			Status:         live.Status,
			ChannelName:    live.ChannelName,
			ChannelARN:     live.ChannelARN,
			StreamARN:      live.StreamARN,
			CreatedAt:      live.CreatedAt,
			StartedAt:      live.StartedAt,
			EndedAt:        live.EndedAt,
			PassphraseSalt: saltHex,
			PassphraseSum:  sumHex,
		})
	}
	sort.Slice(stored.Lives, func(i, j int) bool {
		return stored.Lives[i].CreatedAt.Before(stored.Lives[j].CreatedAt)
	})

	data, err := json.MarshalIndent(stored, "", "  ")
	if err != nil {
		return fmt.Errorf("encode live store: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return fmt.Errorf("create live store directory: %w", err)
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return fmt.Errorf("write live store: %w", err)
	}
	if err := os.Rename(tmp, s.path); err != nil {
		return fmt.Errorf("replace live store: %w", err)
	}
	return nil
}

func NewID() (string, error) {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generate live id: %w", err)
	}
	return hex.EncodeToString(buf), nil
}

func ChannelName(liveID string) string {
	return "yrdy-kbd-" + liveID
}

func StreamName(liveID string) string {
	return "yrdy-kbd-" + liveID
}
