# Generation History Stability Plan

## Goal

Improve the reliability of NAI and ComfyUI history updates after image generation, without redesigning the entire generation-history architecture.

## Problem summary

Compared to module-workflow execution history, the NAI / ComfyUI history list is more fragile because it depends on:
- generation-history rows
- generated file save completion
- image-file registration and metadata visibility
- frontend polling and manual refresh timing

User-visible symptoms:
- new history items sometimes do not appear immediately
- history order can look unstable
- history can appear partially broken or missing until a later refresh

## Scope for this pass

This pass is intentionally limited to two targeted stability improvements:

1. **Backend history query stabilization**
2. **Frontend history refresh stabilization**

## Priority 1 — Backend history query stabilization

### Current risks
- loose join conditions can produce unstable matching
- broad path matching is too permissive
- ordering is not stable enough when many rows share close timestamps

### Target changes
- replace broad path matching with stricter matching
- ensure each history row resolves to one best image-file match
- add deterministic secondary ordering using `id`

### Expected outcome
- less duplicate / missing / reshuffled history behavior
- more stable history list snapshots between polls

## Priority 2 — Frontend history refresh stabilization

### Current risks
- history refresh currently mixes nonce refresh and fixed polling
- query object references are used in refresh effects
- polling continues even when nothing is in flight

### Target changes
- stop depending on query object identity inside refresh effects
- keep explicit nonce-triggered refresh
- use conditional polling only while history contains pending / processing items

### Expected outcome
- less refresh timing conflict
- fewer unnecessary reloads
- more predictable UI updates after generation requests

## Non-goals
- no optimistic history insertion in this pass
- no ComfyUI completion-state redesign in this pass
- no major image-list identity rewrite in this pass
- no route / API architecture refactor in this pass

## Verification

After implementation:
- backend build passes
- frontend build passes
- generation history still loads for NAI and ComfyUI
- polling stops when all visible history rows are terminal
- manual refresh and post-generate refresh still work
