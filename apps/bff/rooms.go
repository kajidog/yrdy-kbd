package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sync"
	"time"
)

type Room struct {
	ID          string
	ChannelName string
	ChannelARN  string
	CreatedAt   time.Time

	passphrase passphraseDigest
}

type RoomStore struct {
	mu    sync.RWMutex
	rooms map[string]Room
}

func NewRoomStore() *RoomStore {
	return &RoomStore{rooms: make(map[string]Room)}
}

func (s *RoomStore) Put(room Room) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.rooms[room.ID] = room
}

func (s *RoomStore) Get(roomID string) (Room, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	room, ok := s.rooms[roomID]
	return room, ok
}

func newRoomID() (string, error) {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generate room id: %w", err)
	}
	return hex.EncodeToString(buf), nil
}

func channelNameForRoom(roomID string) string {
	return "yrdy-kbd-" + roomID
}
