// Athena Code authored source. Only static 1.0.15 contracts are represented;
// host UI behavior and actual hook blocking remain runtime-unverified.
import type { HarnessManifest } from "../../scripts/manifest-types.ts";
import onboardingFills from "./onboarding.fills.ts";

const manifest: HarnessManifest = {
  name: "athenacode",
  productName: "Athena Code",
  configNextStep: "open this project in Athena Code, then run `/aidlc --doctor`",
  choiceNote: "Athena Code 1.0.15",
  harnessDir: ".athena",
  orchestratorSkillPath: ".athena/skills/aidlc/SKILL.md",
  tierFlavor: "athenacode",
  rootIntegrations: [
    {
      path: "AGENTS.md",
      policy: "managed-block",
      marker: "agents",
      shared: "identical",
    },
    { path: ".athenamodes", policy: "whole-file" },
  ],
  coreDirs: [
    { src: "tools", dst: "tools" },
    { src: "aidlc-common", dst: "aidlc-common" },
    { src: "knowledge", dst: "knowledge" },
    { src: "rules", dst: "rules" },
    { src: "sensors", dst: "sensors" },
    { src: "scopes", dst: "scopes" },
    { src: "agents", dst: "agents" },
    { src: "hooks", dst: "hooks" },
    { src: "skills/aidlc-session-cost", dst: "skills/aidlc-session-cost" },
    { src: "skills/aidlc-replay", dst: "skills/aidlc-replay" },
    { src: "skills/aidlc-outcomes-pack", dst: "skills/aidlc-outcomes-pack" },
    { src: "skills/aidlc-issue-report", dst: "skills/aidlc-issue-report" },
    { src: "skills/aidlc-knowledge", dst: "skills/aidlc-knowledge" },
  ],
  harnessFiles: [
    { src: "skills/aidlc/SKILL.md", dst: "skills/aidlc/SKILL.md" },
    { src: "skills/aidlc/question-rendering.md", dst: "skills/aidlc/question-rendering.md" },
    { src: "skills/aidlc/composer.md", dst: "skills/aidlc/composer.md" },
    { src: "skills/aidlc/tables.md", dst: "skills/aidlc/tables.md" },
    { src: "commands/aidlc.md", dst: "commands/aidlc.md" },
    { src: "athenamodes", dst: ".athenamodes", projectRoot: true },
    { src: "hooks/aidlc-athenacode-adapter.ts", dst: "hooks/aidlc-athenacode-adapter.ts" },
    // Static source only: the IDE loader's project discovery remains unverified.
    { src: "hooks/hooks.json", dst: "hooks/hooks.json" },
  ],
  onboarding: {
    dst: "AGENTS.md",
    projectRoot: true,
    harnessDst: "onboarding.md",
    fills: onboardingFills,
  },
  rulesRename: null,
  emit: null,
};

export default manifest;
