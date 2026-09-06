import { execFileSync } from "node:child_process";

export interface GitIdentity {
  email: string;
  name: string | null;
}

export function readGitIdentity(projectDir: string): GitIdentity | null {
  const email = gitConfig(projectDir, "user.email");
  if (!email) return null;
  const name = gitConfig(projectDir, "user.name");
  return { email, name };
}

function gitConfig(projectDir: string, key: string): string | null {
  try {
    const out = execFileSync("git", ["config", "--local", "--get", key], {
      cwd: projectDir,
      encoding: "utf8",
    });
    const v = out.trim();
    return v.length > 0 ? v : null;
  } catch {
    return null;
  }
}
