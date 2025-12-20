# User Facts Storage Bug Report

## Bug Summary

**Issue:** The AI was incorrectly storing nonsense words (like "offf!") as the user's name in the `user_facts` table, despite the user already having their name stored.

**Root Cause:** The system used regex-based pattern matching (`detectAndStoreUserInfo`) to auto-detect user facts from messages. The regex pattern `/^([A-Z][a-z]{1,15})[\s!.,?]*$/i` was too permissive and matched any capitalized word as a potential name.

**Impact:** User's actual name could be overwritten with exclamations, sounds, or other false positives.

---

## Investigation Findings

### Original Implementation (`memoryService.ts:714-926`)

The `detectAndStoreUserInfo` function used hardcoded regex patterns:

```typescript
// Problem pattern - matches "Offf!" as a name
const namePatterns = [
  /(?:i'm|i am|my name is|call me|this is)\s+([A-Z][a-z]+)(?:\s|!|,|\.|\?|$)/i,
  /^([A-Z][a-z]{1,15})[\s!.,?]*$/i  // <-- This catches false positives!
];
```

While a false positives list existed, it couldn't cover every possible exclamation:
```typescript
const falsePositives = ['hi', 'hey', 'hello', 'sure', 'yes', 'no', ...];
// Can't include every possible sound/exclamation
```

### Additional Issues Discovered

1. **No distinction between fact types** - All facts were treated the same (could be overwritten)
2. **No array support** - Preferences like `favorite_lunch_spot` could only hold one value
3. **No semantic understanding** - Regex can't understand context ("I'm tired" vs "I'm Steven")

---

## Solution Implemented

### 1. LLM-Based Fact Detection (replaces regex)

Added **SECTION 7: USER FACT DETECTION** to the unified intent prompt in `intentService.ts`:

```typescript
SECTION 7: USER FACT DETECTION
Detect if the user is sharing FACTUAL information about themselves.
BE VERY CONSERVATIVE - only detect facts when user is clearly stating personal information.

CRITICAL RULES:
1. NEVER detect a name from exclamations, sounds, or nonsense words
2. A name must be explicitly introduced: "I'm Steven", "My name is Sarah"
3. Must have HIGH confidence (>0.8) to suggest storing
```

**Key files changed:**
- `src/services/intentService.ts` - Added `UserFactIntent` interface and SECTION 7 to prompt

### 2. Three-Tier Fact Storage System

Implemented in `processDetectedFacts` function (`memoryService.ts`):

| Type | Behavior | Example Keys |
|------|----------|--------------|
| **IMMUTABLE** | Only store if not already set | `name`, `birthday`, `gender` |
| **MUTABLE** | Can be updated/overwritten | `occupation`, `location`, `relationship_status` |
| **ADDITIVE** | Append to JSON array | `favorite_*`, `likes`, `hobbies` |

```typescript
const IMMUTABLE_KEYS = new Set([
  'name', 'middle_name', 'last_name', 'birthday', 'birth_year', 'gender'
]);

const ADDITIVE_KEY_PATTERNS = [
  /^favorite_/,  // favorite_lunch_spot, favorite_movie
  /^likes$/,     // general likes
  /^hobbies$/,   // hobbies list
];
```

### 3. Duplicate Prevention for Additive Facts

Additive facts now store as JSON arrays with case-insensitive duplicate checking:

```typescript
// Before: "Chipotle"
// User says: "I also like Panera"
// After: ["Chipotle", "Panera"]

// User says: "chipotle" again
// Result: Skipped (already in array)
```

---

## Files Changed

| File | Changes |
|------|---------|
| `src/services/intentService.ts` | Added `UserFactIntent` interface, SECTION 7 prompt, validation |
| `src/services/memoryService.ts` | Added `processDetectedFacts`, fact type classification |
| `src/App.tsx` | Replaced `detectAndStoreUserInfo` calls with LLM-based approach |
| `src/services/tests/processDetectedFacts.test.ts` | **NEW** - 22 test cases |

---

## Test Coverage

Created comprehensive test suite with **22 test cases** covering:

### Empty Input Handling
- [x] Empty array returns empty result
- [x] Null/undefined returns empty result

### Immutable Facts
- [x] Store name if not already set
- [x] NOT overwrite existing name
- [x] NOT overwrite existing birthday
- [x] Protect all immutable keys (name, middle_name, last_name, birthday, birth_year, gender)

### Mutable Facts
- [x] Store new occupation
- [x] UPDATE existing occupation
- [x] UPDATE family location when they move
- [x] UPDATE relationship_status when it changes

### Additive Facts
- [x] Store first favorite as plain value
- [x] APPEND to existing value (create JSON array)
- [x] APPEND to existing JSON array
- [x] NOT add duplicate (case-insensitive)
- [x] Handle "likes" as additive
- [x] Handle "hobbies" as additive
- [x] Handle any "favorite_*" key as additive

### Mixed Fact Types
- [x] Handle immutable, mutable, and additive in same call
- [x] Process multiple new facts correctly

### Error Handling
- [x] Graceful handling of database errors

### Edge Cases
- [x] Same key in different categories treated as separate facts

---

## Run Tests

```bash
# Run all processDetectedFacts tests
npm test -- --run -t "processDetectedFacts"

# Run all tests
npm test -- --run
```

---

## Example: Before vs After

### Before (Buggy Behavior)
```
User message: "offf!"
Regex pattern matches: "Offf" → Stored as name
Result: name = "Offf" (WRONG!)
```

### After (Fixed Behavior)
```
User message: "offf!"
LLM analysis: Not a name introduction, just an exclamation
Result: No fact stored (CORRECT!)

User message: "My name is Steven"
LLM analysis: Explicit name introduction, confidence 0.95
Check: name already exists? No
Result: name = "Steven" (CORRECT!)

User message: "Call me John"
LLM analysis: Name introduction detected, confidence 0.92
Check: name already exists? Yes ("Steven")
Result: Skipped - immutable field (CORRECT!)
```

---

## Backward Compatibility

- The old `detectAndStoreUserInfo` function is marked as `@deprecated` but still exists for reference
- All existing facts in the database remain unchanged
- New facts are processed through the LLM-based system
