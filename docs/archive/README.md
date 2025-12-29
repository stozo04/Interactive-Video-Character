# Archive Directory

Historical documentation for resolved issues, deprecated features, and completed migrations.

## Purpose

This directory preserves historical context for:
- Resolved bug reports
- Deprecated/replaced features
- Migration documentation
- Old implementation approaches

## Structure

```
archive/
├── bugs/           # Resolved bug reports
│   ├── README.md   # Bug archive index
│   └── *.md        # Individual resolved bugs
├── features/       # Deprecated/replaced features (future)
└── migrations/     # Database migration logs (future)
```

## Why Archive?

1. **Historical Context** - Understand past decisions and their rationale
2. **Learning Resource** - Reference for similar future problems
3. **Documentation Trail** - Complete record of system evolution
4. **Knowledge Preservation** - Prevent loss of important context

## Current Archives

### Resolved Bugs (2)
- [IDLE_THOUGHTS_NOT_TRIGGERED.md](bugs/IDLE_THOUGHTS_NOT_TRIGGERED.md) - Scheduler implementation
- [IDLE_THOUGHTS_DATABASE_FIXES.md](bugs/IDLE_THOUGHTS_DATABASE_FIXES.md) - Database optimizations

## Archive Guidelines

### When to Archive

- ✅ Bug is completely fixed and tested
- ✅ Feature is fully replaced by newer implementation
- ✅ Migration is complete and verified
- ✅ Documentation exists in active docs

### How to Archive

1. Mark original document as RESOLVED
2. Link to replacement/fix documentation
3. Move to appropriate archive subdirectory
4. Update archive README with entry
5. Ensure links from active docs still work

### Archive vs Delete

**Archive** if:
- Historical context is valuable
- Solution approach is complex
- May be referenced in future
- Provides learning opportunity

**Delete** if:
- Document is duplicate
- Information is fully captured elsewhere
- No historical value
- Confusing or misleading

## Related Directories

- **`docs/features/`** - Active feature documentation
- **`docs/bugs/`** - Unresolved bugs
- **`docs/plans/`** - Implementation plans
