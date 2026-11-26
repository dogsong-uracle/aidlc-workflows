// Athena Code onboarding fills. The feature audit is static-only; do not claim
// that hook refusals or native mode permissions have been observed in the IDE.
import type { OnboardingFills } from "../../scripts/onboarding.ts";

const fills: OnboardingFills = {
  invoke: "/aidlc",
  slots: {
    frontmatter: "---\nactivation: always\n---",
    title_block: `# AI-DLC on Athena Code

This project carries AI-DLC's project-local runtime in ".athena/". Start or continue work by invoking "/aidlc" and describing what you want to do. Use "/aidlc --doctor" to inspect the setup. Athena Code 1.0.15's hook and mode behavior has only been checked statically; IDE discovery, enforcement, and command UI loading remain unverified.
`,
    prereq_bullets: `- **Uracle Athena Code 1.0.15**: the installed version used for the static contract audit.
- **Bun**: required for the authored hook adapter and the project's AI-DLC CLI scripts.
- **Project setup**: run \`aidlc config --harness athenacode\` to project the runtime into \`.athena/\`.
- **Hooks**: the static 1.0.15 registry candidate is projected inside \`.athena/hooks/\`. Whether Athena discovers it and blocks tools has not been tested in the IDE. Do not rely on it as an enforcement boundary.`,
    prereq_bullets_tail: "",
    agents_note: `The project-local \`.athenamodes\` source carries the conductor and 14 core persona entries. Custom Mode activation and tool group enforcement require Athena IDE validation.`,
    hook_permissions_note: `The adapter uses fixed argument arrays for child processes and does not accept commands from the payload. This code-level property is not proof that Athena discovers the registry or blocks a tool when the adapter emits a refusal.`,
    structure_extra: "",
    sections_before_resumption: `## What's different on this harness

- The static Athena 1.0.15 bundle exposes \`SessionStart\`, \`PreToolUse\`, \`PostToolUse\`, \`Stop\`, and an inert \`UserPromptSubmit\` path. Only SessionStart and Stop are currently normalized to core hooks.
- Tool name/input mappings for Athena's PreToolUse and PostToolUse payloads have not been established, so guard, audit, sensor and human-turn dispatch are intentionally absent.
- No session identifier is present in the audited payload. \`task_id\` is validated as task identity and is never represented as a session ID.
- Revalidate these boundaries in an isolated Athena project before treating hook support as available.`,
    sections_after_resumption: "",
  },
};

export default fills;
