import { defineConfig, configDefaults } from "vitest/config";

const testShared = {
  exclude: [...configDefaults.exclude, "**/.claude/**"],
  testTimeout: 60_000,
  hookTimeout: 60_000,
};

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          ...testShared,
          name: "unit",
          sequence: { groupOrder: 0 },
          include: ["packages/*/src/**/*.test.ts"],
          isolate: false,
        },
      },
      {
        test: {
          ...testShared,
          name: "integration",
          sequence: { groupOrder: 1 },
          // Real Crawlee runners against an in-process fixture server — no
          // external services, but each file spins up sockets, so keep the
          // default per-file isolation.
          include: ["packages/*/tests/integration/**/*.test.ts"],
        },
      },
    ],
  },
});
