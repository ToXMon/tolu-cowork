/**
 * @tolu/cowork-core — Services module tests
 *
 * Tests for SchedulerService, SkillsService, ProjectsService, SubAgentsService.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  SchedulerService,
  InvalidCronError,
  TaskNotFoundError,
} from "../scheduler-service.js";
import {
  SkillsService,
  SkillNotFoundError,
} from "../skills-service.js";
import {
  ProjectsService,
  ProjectNotFoundError,
  ProjectExistsError,
  InvalidWorkspaceError,
} from "../projects-service.js";
import {
  SubAgentsService,
} from "../sub-agents-service.js";
import { ToluProvider } from "../../provider/tolu-provider.js";
import { ToluAgent } from "../../agent/tolu-agent.js";

// ─── SchedulerService ────────────────────────────────────────────────────────

describe("SchedulerService", () => {
  let tmpDir: string;
  let scheduler: SchedulerService;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tolu-sched-test-"));
    scheduler = new SchedulerService(path.join(tmpDir, "tasks.json"));
  });

  afterEach(async () => {
    scheduler.stop();
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it("addTask creates a task with valid cron", async () => {
    const task = await scheduler.addTask({
      name: "test-task", cron: "0 9 * * *", prompt: "run daily report", enabled: true,
    });
    expect(task.id).toBeDefined();
    expect(task.name).toBe("test-task");
    expect(task.cron).toBe("0 9 * * *");
    expect(task.createdAt).toBeGreaterThan(0);
  });

  it("addTask throws InvalidCronError for bad cron", async () => {
    await expect(scheduler.addTask({ name: "bad", cron: "invalid", prompt: "x", enabled: true })).rejects.toThrow(InvalidCronError);
  });

  it("listTasks returns all tasks", async () => {
    await scheduler.addTask({ name: "t1", cron: "* * * * *", prompt: "p1", enabled: true });
    await scheduler.addTask({ name: "t2", cron: "0 0 * * *", prompt: "p2", enabled: true });
    const tasks = scheduler.listTasks();
    expect(tasks).toHaveLength(2);
    expect(tasks.map((t) => t.name).sort()).toEqual(["t1", "t2"]);
  });

  it("removeTask deletes a task", async () => {
    const task = await scheduler.addTask({ name: "to-remove", cron: "* * * * *", prompt: "p", enabled: true });
    await scheduler.removeTask(task.id);
    expect(scheduler.listTasks()).toHaveLength(0);
  });

  it("removeTask throws TaskNotFoundError for missing task", async () => {
    await expect(scheduler.removeTask("nonexistent")).rejects.toThrow(TaskNotFoundError);
  });

  it("enableTask and disableTask toggle state", async () => {
    const task = await scheduler.addTask({ name: "toggle", cron: "* * * * *", prompt: "p", enabled: false });
    expect(task.enabled).toBe(false);
    await scheduler.enableTask(task.id);
    expect(scheduler.getTask(task.id)?.enabled).toBe(true);
    await scheduler.disableTask(task.id);
    expect(scheduler.getTask(task.id)?.enabled).toBe(false);
  });

  it("start loads tasks from disk", async () => {
    await scheduler.addTask({ name: "loaded", cron: "* * * * *", prompt: "p", enabled: true });
    await scheduler.start();
    expect(scheduler.listTasks()).toHaveLength(1);
    expect(scheduler.listTasks()[0].name).toBe("loaded");
  });

  it("stop clears all cron jobs", async () => {
    await scheduler.start();
    await scheduler.addTask({ name: "t", cron: "* * * * *", prompt: "p", enabled: true });
    scheduler.stop();
    expect(scheduler.listTasks()).toHaveLength(1);
  });

  it("runTaskNow emits events and updates lastRun", async () => {
    const task = await scheduler.addTask({ name: "run", cron: "* * * * *", prompt: "p", enabled: true });
    const startSpy = vi.fn();
    const completeSpy = vi.fn();
    scheduler.on("taskStart", startSpy);
    scheduler.on("taskComplete", completeSpy);
    await scheduler.runTaskNow(task.id);
    expect(startSpy).toHaveBeenCalledWith(expect.objectContaining({ id: task.id }));
    expect(completeSpy).toHaveBeenCalledWith(expect.objectContaining({ id: task.id }));
    expect(scheduler.getTask(task.id)?.lastRun).toBeGreaterThan(0);
  });

  it("runTaskNow throws TaskNotFoundError for missing", async () => {
    await expect(scheduler.runTaskNow("nonexistent")).rejects.toThrow(TaskNotFoundError);
  });

  it("getTask returns undefined for missing", () => {
    expect(scheduler.getTask("missing")).toBeUndefined();
  });
});

// ─── SkillsService ───────────────────────────────────────────────────────────

describe("SkillsService", () => {
  let tmpDir: string;
  let service: SkillsService;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tolu-skills-test-"));
    service = new SkillsService([tmpDir]);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it("loadSkills reads .md files with frontmatter", async () => {
    await fs.writeFile(path.join(tmpDir, "test-skill.md"),
      "---\nname: test-skill\ndescription: A test skill\n---\n# Body\nContent here.", "utf-8");
    await service.loadSkills();
    const skills = service.listSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("test-skill");
    expect(skills[0].description).toBe("A test skill");
    expect(skills[0].content).toContain("Content here.");
  });

  it("uses filename as name when frontmatter has no name", async () => {
    await fs.writeFile(path.join(tmpDir, "my-skill.md"), "---\n\n---\nBody", "utf-8");
    await service.loadSkills();
    expect(service.getSkill("my-skill")?.name).toBe("my-skill");
  });

  it("getSkill returns undefined for missing", () => {
    expect(service.getSkill("nonexistent")).toBeUndefined();
  });

  it("searchSkills finds skills by content", async () => {
    await fs.writeFile(path.join(tmpDir, "a.md"), "---\nname: alpha\n---\nPython expert", "utf-8");
    await fs.writeFile(path.join(tmpDir, "b.md"), "---\nname: beta\n---\nRust expert", "utf-8");
    await service.loadSkills();
    expect(service.searchSkills("python")).toHaveLength(1);
    expect(service.searchSkills("python")[0].name).toBe("alpha");
  });

  it("getSkillPrompt throws SkillNotFoundError for missing", () => {
    expect(() => service.getSkillPrompt("missing")).toThrow(SkillNotFoundError);
  });

  it("getSkillPrompt returns formatted prompt", async () => {
    await fs.writeFile(path.join(tmpDir, "s.md"), "---\nname: s\ndescription: desc\n---\nBody", "utf-8");
    await service.loadSkills();
    const prompt = service.getSkillPrompt("s");
    expect(prompt).toContain("## Skill: s");
    expect(prompt).toContain("desc");
    expect(prompt).toContain("Body");
  });

  it("reload refreshes cache", async () => {
    await fs.writeFile(path.join(tmpDir, "x.md"), "---\nname: x\n---\nFirst", "utf-8");
    await service.loadSkills();
    expect(service.listSkills()).toHaveLength(1);
    await fs.writeFile(path.join(tmpDir, "y.md"), "---\nname: y\n---\nSecond", "utf-8");
    await service.reload();
    expect(service.listSkills()).toHaveLength(2);
  });

  it("handles missing directory gracefully", async () => {
    const bad = new SkillsService(["/nonexistent/path"]);
    await bad.loadSkills();
    expect(bad.listSkills()).toHaveLength(0);
  });
});

// ─── ProjectsService ─────────────────────────────────────────────────────────

describe("ProjectsService", () => {
  let tmpDir: string;
  let workspaceDir: string;
  let service: ProjectsService;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tolu-proj-test-"));
    workspaceDir = path.join(tmpDir, "workspace");
    await fs.mkdir(workspaceDir, { recursive: true });
    service = new ProjectsService(path.join(tmpDir, "projects"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it("createProject creates project with valid workspace", async () => {
    const project = await service.createProject("my-project", workspaceDir, "Test");
    expect(project.name).toBe("my-project");
    expect(project.path).toBe(workspaceDir);
    expect(project.description).toBe("Test");
  });

  it("createProject writes default config", async () => {
    await service.createProject("p1", workspaceDir);
    const raw = await fs.readFile(path.join(workspaceDir, "tolu.config.json"), "utf-8");
    expect(JSON.parse(raw).provider).toBeDefined();
  });

  it("createProject throws InvalidWorkspaceError for missing dir", async () => {
    await expect(service.createProject("bad", "/nonexistent/path")).rejects.toThrow(InvalidWorkspaceError);
  });

  it("createProject throws ProjectExistsError on duplicate", async () => {
    await service.createProject("dup", workspaceDir);
    await expect(service.createProject("dup", workspaceDir)).rejects.toThrow(ProjectExistsError);
  });

  it("getProject returns created project", async () => {
    await service.createProject("find-me", workspaceDir);
    expect((await service.getProject("find-me"))?.name).toBe("find-me");
  });

  it("getProject returns undefined for missing", async () => {
    expect(await service.getProject("missing")).toBeUndefined();
  });

  it("listProjects returns all", async () => {
    await service.createProject("a", workspaceDir);
    await service.createProject("b", workspaceDir);
    expect((await service.listProjects()).length).toBe(2);
  });

  it("openProject increments session count", async () => {
    await service.createProject("s", workspaceDir);
    const { project: p1 } = await service.openProject("s");
    expect(p1.sessionCount).toBe(1);
    const { project: p2 } = await service.openProject("s");
    expect(p2.sessionCount).toBe(2);
  });

  it("openProject throws for missing", async () => {
    await expect(service.openProject("missing")).rejects.toThrow(ProjectNotFoundError);
  });

  it("deleteProject removes metadata", async () => {
    await service.createProject("del", workspaceDir);
    await service.deleteProject("del");
    expect(await service.getProject("del")).toBeUndefined();
  });

  it("deleteProject throws for missing", async () => {
    await expect(service.deleteProject("missing")).rejects.toThrow(ProjectNotFoundError);
  });
});

// ─── SubAgentsService ────────────────────────────────────────────────────────

describe("SubAgentsService", () => {
  function makeService() {
    const provider = new ToluProvider({ baseUrl: "https://api.openai.com/v1", apiKey: "test", model: "gpt-4o" });
    const agent = new ToluAgent({ provider });
    return { service: new SubAgentsService(agent, provider) };
  }

  it("spawn creates a new sub-agent", () => {
    const { service } = makeService();
    const sub = service.spawn("worker-1", "code reviewer");
    expect(sub.id).toBeDefined();
    expect(sub.name).toBe("worker-1");
    expect(sub.role).toBe("code reviewer");
    expect(sub.status).toBe("idle");
  });

  it("listSubAgents returns all", () => {
    const { service } = makeService();
    service.spawn("a", "r-a");
    service.spawn("b", "r-b");
    expect(service.listSubAgents()).toHaveLength(2);
  });

  it("getStatus returns sub-agent info", () => {
    const { service } = makeService();
    const sub = service.spawn("s", "role");
    expect(service.getStatus(sub.id)?.name).toBe("s");
  });

  it("getStatus returns undefined for missing", () => {
    expect(makeService().service.getStatus("missing")).toBeUndefined();
  });

  it("terminate removes sub-agent", () => {
    const { service } = makeService();
    const sub = service.spawn("x", "role");
    service.terminate(sub.id);
    expect(service.getStatus(sub.id)).toBeUndefined();
  });

  it("terminateAll clears all", () => {
    const { service } = makeService();
    service.spawn("a", "r");
    service.spawn("b", "r");
    service.terminateAll();
    expect(service.listSubAgents()).toHaveLength(0);
  });

  it("terminate handles nonexistent gracefully", () => {
    expect(() => makeService().service.terminate("nonexistent")).not.toThrow();
  });
});
