import { expect, test } from "bun:test";
import { checkPatch } from "../server/fix";

const t = { path: "vllm/v1/attention/ops/triton_decode_attention.py", ref: "v0.31.0" };
const source = "def f():\n    num_stages = 2\n    return num_stages\n";
const good = `--- a/${t.path}
+++ b/${t.path}
@@ -1,3 +1,3 @@
 def f():
-    num_stages = 2
+    num_stages = 1
     return num_stages
`;

test("accepts a patch that applies and touches only the target file", async () => {
  expect(await checkPatch(good, t, source)).toBeUndefined();
});

test("refuses a patch that touches another file", async () => {
  const other = good.replaceAll(t.path, "vllm/envs.py");
  expect(await checkPatch(other, t, source)).toContain("only");
});

test("refuses a patch that does not apply", async () => {
  expect(await checkPatch(good, t, "def g():\n    pass\n")).toContain("does not apply");
});

test("refuses text that is not a diff", async () => {
  expect(await checkPatch("set num_stages to 1", t, source)).toContain("not a unified diff");
});
