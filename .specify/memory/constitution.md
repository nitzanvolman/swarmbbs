<!--
SYNC IMPACT REPORT
==================
Version Change: 1.2.0 → 1.2.1
Rationale: Minor change to new principle VII (Autonomous Task Completion) - MINOR version bump

Modified Principles: VII: Autonomous Task Completion
  - Location for the decisions log
  - Defined method of asking for user input. 

Removed Sections: None

Templates Requiring Updates:
  ✅ .specify/templates/plan-template.md - No changes needed
  ✅ .specify/templates/spec-template.md - No changes needed
  ✅ .specify/templates/tasks-template.md - No changes needed

Follow-up TODOs: None
-->

# SwarmBBS Constitution

## Core Principles

### I. Parallel Task Execution (NON-NEGOTIABLE)

All independent tasks MUST be executed in parallel using Claude Code's Task tool for spawning concurrent sub-agents. Tasks must be separated into isolated units to minimize possibility of conflicts, with each task operating on separate files.

**Rationale**: Parallel execution maximizes development velocity and resource utilization. Serial execution of independent tasks wastes time and delays delivery.

**Implementation Requirements**:
- All parallel operations MUST be invoked in a single message with multiple Task tool calls
- Each task MUST be isolated to prevent file conflicts
- Tasks operating on the same files MUST be executed sequentially
- Prefer parallel execution unless explicit dependencies exist

**Example Pattern**:
```javascript
// ✅ CORRECT: Single message with multiple Task tool calls
[Single Message]:
  Task("Research agent", "Analyze requirements and patterns...", "researcher")
  Task("Coder agent", "Implement core features...", "coder")
  Task("Tester agent", "Create comprehensive tests...", "tester")
  Task("Reviewer agent", "Review code quality...", "reviewer")
```

### II. Test-Driven Development (NON-NEGOTIABLE)

All features MUST follow strict Test-Driven Development: Write tests first, ensure user approval, verify tests fail (Red), implement functionality to pass tests (Green), then refactor for quality (Refactor).

**Rationale**: TDD ensures requirements are testable, prevents scope creep, and provides immediate feedback on implementation correctness. Tests serve as executable specifications and regression safety nets.

**Implementation Requirements**:
- Tests MUST be written before implementation code
- All functional requirements MUST have test coverage
- All tests MUST pass before code is considered complete
- Red-Green-Refactor cycle MUST be strictly enforced
- Tests MUST be independently executable and deterministic

### III. Organized File Structure (NON-NEGOTIABLE)

Working files, documentation, and tests MUST NEVER be saved to the repository root folder. All artifacts must follow the prescribed organizational structure.

**Rationale**: Clear organization prevents clutter, enables tooling, and makes navigation intuitive. Root-level pollution degrades developer experience and complicates automation.

**File Organization Rules**:
- **Persistent artifacts** (spec.md, plan.md, tasks.md): `specs/<feature-id>/`
- **Ephemeral coordination files** (ad-hoc analysis, temporary notes): `temp/`
- **Source code**: Language-appropriate structure (`src/`, `lib/`, etc.)
- **Tests**: `tests/` with subdirectories for `unit/`, `integration/`, `contract/`
- **Root directory**: Reserved for essential project files only (package.json, README.md, etc.)

### IV. Modular Code Architecture

All source files MUST be kept under 500 lines of code. Large files MUST be broken into smaller, focused modules with clear responsibilities.

**Rationale**: Small files are easier to understand, test, review, and maintain. Enforced modularity prevents god objects and encourages separation of concerns.

**Implementation Requirements**:
- Maximum 500 lines per file (including comments and whitespace)
- Each module MUST have a single, well-defined responsibility
- Prefer composition over inheritance for code reuse
- Extract shared functionality into utility modules
- Use clear naming conventions that reflect module purpose

### V. Claude Code Task Tool as Primary Agent Spawner

Claude Code's Task tool is the PRIMARY and REQUIRED mechanism for spawning sub-agents. Alternative agent execution methods are prohibited unless Task tool is unavailable.

**Rationale**: The Task tool is purpose-built for Claude Code's architecture, provides proper isolation, enables parallel execution, and ensures consistent agent lifecycle management.

**Implementation Requirements**:
- Use Task tool with appropriate subagent_type for all agent spawning
- Leverage parallel Task invocations for concurrent work
- Provide clear, actionable prompts to agents
- Specify expected outputs in agent prompts
- Trust agent outputs unless clear errors exist

### VI. Fail-Fast Error Handling (NON-NEGOTIABLE)

Systems MUST fail immediately with clear, actionable error messages when problems occur. Hidden fallbacks that silently degrade quality or performance are strictly prohibited. Users MUST be informed of all failures and degradations.

**Rationale**: Silent failures and hidden fallbacks create invisible quality degradation, make debugging impossible, and erode user trust. Explicit failures enable quick detection, clear diagnosis, and rapid resolution.

**Implementation Requirements**:
- Fail immediately when encountering errors or invalid states
- Error messages MUST be clear, specific, and actionable
- Include context: what failed, why it failed, what to do next
- Never substitute degraded behavior without explicit user awareness
- Log all errors with sufficient context for debugging
- Avoid catch-all exception handlers that hide problems
- Prefer explicit error returns over silent defaults
- Surface configuration errors at startup, not during operation

**Anti-Patterns** (prohibited):
- ❌ Catching errors and returning empty results without warning
- ❌ Falling back to degraded performance without notification
- ❌ Using default values when configuration is missing or invalid
- ❌ Continuing operation after critical component failures
- ❌ Generic error messages like "Something went wrong"
- ❌ Swallowing exceptions in background processes

**Example Patterns**:
```javascript
// ✅ CORRECT: Fail fast with clear message
if (!config.apiKey) {
  throw new Error(
    "API key not configured. Set API_KEY environment variable or add to config.json"
  );
}

// ❌ WRONG: Silent fallback
const apiKey = config.apiKey || "default-key"; // Hides configuration problem
```

### VII. Autonomous Task Completion (NON-NEGOTIABLE)

When given a task, agents MUST carry on autonomously until the task is complete. Agents MUST NOT stop to request human instructions unless it is absolutely necessary and continuation is impossible without human input. When decisions are required, agents MUST use their best judgment, document their reasoning in `specs/<feature-id>/decisions.md`, and continue execution.

**Rationale**: Autonomous execution maximizes productivity and reduces human interruption overhead. Agents have sufficient context and capability to make informed decisions. Pausing for trivial confirmations wastes time and breaks flow. Human review of logged reasoning is more efficient than real-time approval gates.

**Implementation Requirements**:
- Complete assigned tasks without human intervention unless truly blocked
- Make informed decisions using available context and best practices
- Document all significant decisions in `specs/<feature-id>/decisions.md` with clear reasoning
- Log decision rationale for human review after task completion
- Only request human input when:
  - Critical business decisions with significant financial/legal implications
  - Ambiguous requirements with multiple valid interpretations that fundamentally change scope
  - Destructive operations without clear rollback paths
  - Security/privacy decisions requiring policy choices
- Prefer sensible defaults and industry best practices over human confirmation
- Continue execution after making decisions rather than waiting for approval
- If a human decision is absolutly required and cannot be avoided:
  - Explain the context and impact concisely.
  - Present two or three options and their rational for the user to choose from.
  - Mark your recommended option with 🌟.
  - Use the AskUserQuestion tool to reduce the users cognitive load.  

**Decision Documentation Pattern**:
```markdown
## Autonomous Decisions Log

### Decision 1: [Brief Title]
**Context**: [What situation required a decision]
**Options Considered**:
  - Option A: [Description] - Rejected because [reason]
  - Option B: [Description] - **SELECTED** because [reason]
**Rationale**: [Detailed explanation of why this choice best serves the task]
**Impact**: [What this decision affects]
**Reversibility**: [How easily this can be changed if needed]

### Decision 2: ...
```

**When Human Input IS Required** (rare cases):
- Choosing between fundamentally different architectural approaches with long-term implications
- Deciding on data retention policies or user privacy handling
- Approving destructive operations (delete production data, drop databases)
- Resolving true requirement ambiguities that change feature scope significantly

**When Human Input is NOT Required** (proceed autonomously):
- Choosing between similar technical implementations (library A vs library B)
- Selecting code organization patterns within established conventions
- Making performance optimization trade-offs within documented constraints
- Handling edge cases with reasonable default behaviors
- Refactoring code structure for maintainability
- Writing documentation and examples
- Choosing test strategies and coverage approaches

## Development Workflow

### Planning Phase

1. **Feature Specification**: Create detailed spec in `specs/<feature-id>/spec.md`
   - User stories with acceptance criteria
   - Functional requirements (FR-XXX format)
   - Success criteria with measurable outcomes

2. **Implementation Planning**: Generate plan in `specs/<feature-id>/plan.md`
   - Technical context and constraints
   - Constitution compliance check
   - Project structure definition
   - Complexity justification (if needed)

3. **Task Generation**: Create actionable tasks in `specs/<feature-id>/tasks.md`
   - Organized by user story priority
   - Marked for parallel execution where applicable
   - Dependencies explicitly documented

### Implementation Phase

1. **Test Creation**: Write tests first for each user story
   - Contract tests for interfaces
   - Integration tests for user journeys
   - Unit tests for complex logic (if needed)

2. **Red Phase**: Verify all tests fail with clear error messages

3. **Green Phase**: Implement minimum code to pass tests
   - Use parallel Task tool invocations for independent modules
   - Follow file organization rules
   - Respect 500-line limit
   - **Execute autonomously**: Make necessary technical decisions without human approval (see Principle VII)
   - Document significant decisions in decisions log for later review

4. **Refactor Phase**: Improve code quality without changing behavior
   - Extract common patterns
   - Improve naming and structure
   - Verify tests still pass
   - **Continue autonomously**: Refactor without seeking approval unless changing public APIs

### Review Phase

1. **Constitution Compliance**: Verify all principles followed
2. **Test Coverage**: Confirm all requirements tested
3. **Code Quality**: Check modularity and file sizes
4. **Documentation**: Ensure specs and plans are current
5. **Decision Review**: Review autonomous decisions log if present

## Quality Standards

### Code Quality Gates

All code MUST satisfy:
- ✅ All tests passing
- ✅ Test coverage for all functional requirements
- ✅ No files exceeding 500 lines
- ✅ Clear module responsibilities
- ✅ Proper file organization (no root pollution)
- ✅ Constitution compliance verified

### Performance Standards

Performance requirements are feature-specific and MUST be:
- Documented in spec.md Success Criteria
- Translated to measurable tests
- Validated in integration testing
- Justified if violating simplicity principle

### Security Standards

Security is mandatory for all features:
- Input validation on all external data
- Proper error handling without information leakage
- Authentication/authorization where applicable
- No hardcoded secrets or credentials
- Security testing for sensitive operations

### Error Handling Standards

All code MUST follow fail-fast principles (see Principle VI):
- Clear, actionable error messages with context
- No silent fallbacks or degraded behavior without user notification
- Configuration validation at startup
- Explicit error propagation (no swallowed exceptions)
- Error logs with sufficient debugging context

## Governance

### Constitution Authority

This constitution supersedes all other development practices, guidelines, and conventions. When conflicts arise between this constitution and other documentation, the constitution takes precedence.

### Amendment Process

Constitutional amendments require:
1. Documented rationale for change
2. Impact analysis on existing features
3. Migration plan for affected code
4. Version bump following semantic versioning:
   - **MAJOR**: Breaking changes to principles or governance
   - **MINOR**: New principles or material expansions
   - **PATCH**: Clarifications and non-semantic improvements

### Compliance Review

All development work MUST be verified against this constitution:
- Planning phase: Constitution Check in plan.md
- Implementation phase: Active compliance during development
- Review phase: Explicit constitution compliance verification
- Pull request reviews MUST include constitution compliance

### Complexity Justification

Violations of constitutional principles require explicit justification:
- Document the specific violation
- Explain why it is necessary
- Describe simpler alternatives rejected and why
- Track in plan.md Complexity Tracking section

### Version Control

**Version**: 1.2.1 | **Ratified**: 2025-11-12 | **Last Amended**: 2025-11-12
