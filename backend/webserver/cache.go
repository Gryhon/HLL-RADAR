package webserver

import (
	"fmt"
	"strings"
	"sync"
	"time"
)

// CacheEntry represents a cached item with expiration
type CacheEntry struct {
	Data      interface{}
	ExpiresAt time.Time
}

// CacheManager provides in-memory caching for timeline data
type CacheManager struct {
	cache   map[string]CacheEntry
	mu      sync.RWMutex
	ttl     time.Duration
	maxSize int
}

// NewCacheManager creates a new cache manager with specified TTL and max size
func NewCacheManager(ttl time.Duration, maxSize int) *CacheManager {
	cm := &CacheManager{
		cache:   make(map[string]CacheEntry),
		ttl:     ttl,
		maxSize: maxSize,
	}

	// Start cleanup goroutine
	go cm.cleanup()

	return cm
}

// Get retrieves a value from the cache
func (cm *CacheManager) Get(key string) (interface{}, bool) {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	entry, exists := cm.cache[key]
	if !exists {
		return nil, false
	}

	// Check if expired
	if time.Now().After(entry.ExpiresAt) {
		return nil, false
	}

	return entry.Data, true
}

// Set stores a value in the cache
func (cm *CacheManager) Set(key string, data interface{}) {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	// Check if we need to evict entries
	if len(cm.cache) >= cm.maxSize {
		cm.evictOldest()
	}

	cm.cache[key] = CacheEntry{
		Data:      data,
		ExpiresAt: time.Now().Add(cm.ttl),
	}
}

// Clear removes all entries for a specific match
func (cm *CacheManager) Clear(matchID int64) {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	prefix := fmt.Sprintf("timeline:%d:", matchID)
	for key := range cm.cache {
		if strings.HasPrefix(key, prefix) {
			delete(cm.cache, key)
		}
	}
}

// ClearAll removes all entries from the cache
func (cm *CacheManager) ClearAll() {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	cm.cache = make(map[string]CacheEntry)
}

// evictOldest removes the oldest entry from the cache
func (cm *CacheManager) evictOldest() {
	var oldestKey string
	var oldestTime time.Time

	for key, entry := range cm.cache {
		if oldestKey == "" || entry.ExpiresAt.Before(oldestTime) {
			oldestKey = key
			oldestTime = entry.ExpiresAt
		}
	}

	if oldestKey != "" {
		delete(cm.cache, oldestKey)
	}
}

// cleanup periodically removes expired entries
func (cm *CacheManager) cleanup() {
	ticker := time.NewTicker(cm.ttl / 2) // Cleanup every half TTL
	defer ticker.Stop()

	for range ticker.C {
		cm.mu.Lock()
		now := time.Now()
		for key, entry := range cm.cache {
			if now.After(entry.ExpiresAt) {
				delete(cm.cache, key)
			}
		}
		cm.mu.Unlock()
	}
}

// Size returns the current number of entries in the cache
func (cm *CacheManager) Size() int {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	return len(cm.cache)
}
