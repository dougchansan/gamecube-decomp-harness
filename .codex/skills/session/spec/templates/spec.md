# Spec

## Overview

{{INITIAL_UNDERSTANDING}}

## Problem Statement

*What problem are we solving? Why does it matter?*

## Goals

### High-Level Goals

*The north star - what does ultimate success look like? Include WHY this matters.*

### Mid-Level Goals

*Major capabilities or milestones needed to achieve high-level goals. Capture the reasoning behind each.*

### Detailed Goals

*Specific behaviors or features - added as conversation progresses. Note user's preferences and "taste".*

## Non-Goals

*What we are explicitly NOT building - prevents scope creep*

-

## Success Criteria

*How do we know we're done? Testable outcomes*

- [ ]

## Context & Background

*Relevant existing systems, prior art, stakeholder input. Include user's mental model and design philosophy when relevant.*

## Design

<!-- Build vertical-slice subsections as the spec emerges. Each slice describes a coherent unit of change with inline artifacts (ascii / filetree / sequence). No prescribed sub-headings. -->

### Example slice — feature X

Brief prose describing the slice: what it changes, why, and how the artifacts below fit together.

```ascii
┌──────────┐     1:N     ┌──────────┐
│  Project  │────────────▶│  Session  │
│           │             │           │
│ - name    │             │ - topic   │
│ - slug    │             │ - status  │
└──────────┘             └─────┬─────┘
                               │ 1:N
                               ▼
                         ┌──────────┐
                         │ Artifact │
                         │          │
                         │ - type   │
                         │ - path   │
                         └──────────┘
```

```filetree
project/
├── src/
│   ├── components/
│   │   ├── NewComponent.tsx    # new
│   │   └── ExistingOne.tsx     # modified
│   └── utils/
│       └── helper.ts           # new
├── tests/
│   └── NewComponent.test.tsx   # new
└── package.json                # modified
```

```sequence
sequenceDiagram
    participant Client
    participant Server
    Client->>Server: request
    Server-->>Client: response
```

## Notes

*Working notes, ideas, considerations*

