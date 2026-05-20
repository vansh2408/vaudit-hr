/**
 * /api/admin/employees/import
 *  POST → CSV bulk import. Accepts either multipart/form-data with `file`
 *         + `mode` + `existingEmailPolicy` fields, or JSON body with `csv`
 *         text. Query `?mode=dryrun|commit` is also honoured for callers that
 *         only want to flip the mode without resending the file.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { csvImportBodySchema } from "@/lib/validation/common";
import { apiError, handleRouteError } from "@/lib/api/errors";
import {
  importEmployeesFromCsv,
  type ExistingEmailPolicy,
  type ImportMode,
} from "@/lib/csv/import";
import { writeAuditLog } from "@/lib/audit/log";
import { assertSameOrigin } from "@/lib/security/csrf";

/**
 * Hard cap on CSV upload body — threat-model T3. Anything larger is
 * rejected with 413 BEFORE we read the body into memory. The cap covers
 * both the multipart envelope and JSON-encoded bodies (the latter inflates
 * a CSV by ~33% if base64'd, hence the slightly generous ceiling).
 */
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

interface ReadBodyResult {
  csv: string;
  mode: ImportMode;
  policy: ExistingEmailPolicy;
}

async function readBody(req: NextRequest): Promise<ReadBodyResult> {
  const url = new URL(req.url);
  const modeParam = url.searchParams.get("mode");
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    const fileText =
      typeof file === "string"
        ? file
        : file instanceof Blob
          ? await file.text()
          : "";
    const mode = (form.get("mode") ?? modeParam ?? "dryrun") as ImportMode;
    const policy = (form.get("existingEmailPolicy") ?? "skip") as ExistingEmailPolicy;
    const parsed = csvImportBodySchema.parse({
      csv: fileText,
      mode,
      existingEmailPolicy: policy,
    });
    return { csv: parsed.csv, mode: parsed.mode, policy: parsed.existingEmailPolicy };
  }
  const json = (await req.json()) as Record<string, unknown>;
  if (modeParam && !json["mode"]) json["mode"] = modeParam;
  const parsed = csvImportBodySchema.parse(json);
  return { csv: parsed.csv, mode: parsed.mode, policy: parsed.existingEmailPolicy };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const csrf = assertSameOrigin(req);
    if (csrf) return csrf;
    // T3: enforce a hard size cap BEFORE we touch req.json() / formData().
    // A spoofed Content-Length still requires the client to actually deliver
    // those bytes; this header check rejects the obvious 100 MB upload
    // attempt instantly without buffering anything.
    const contentLength = req.headers.get("content-length");
    if (contentLength) {
      const n = Number.parseInt(contentLength, 10);
      if (Number.isFinite(n) && n > MAX_IMPORT_BYTES) {
        return apiError(
          413,
          "PAYLOAD_TOO_LARGE",
          `CSV upload exceeds ${MAX_IMPORT_BYTES} bytes`,
        );
      }
    }
    const session = await requireAdmin();
    const { csv, mode, policy } = await readBody(req);
    // Belt-and-braces: a missing / lying Content-Length still gets caught
    // post-parse. UTF-8 string length ≈ byte length for typical CSV content,
    // and the schema already enforces csv.min(1) so we know it's non-empty.
    if (csv.length > MAX_IMPORT_BYTES) {
      return apiError(
        413,
        "PAYLOAD_TOO_LARGE",
        `CSV upload exceeds ${MAX_IMPORT_BYTES} bytes`,
      );
    }
    const result = await importEmployeesFromCsv(csv, mode, policy, session.user.id);
    if (mode === "commit") {
      await writeAuditLog({
        actorId: session.user.id,
        action: "employee.import_commit",
        targetTable: "users",
        targetId: null,
        metadata: {
          totalRows: result.totalRows,
          inserted: result.committed?.inserted ?? 0,
          updated: result.committed?.updated ?? 0,
          balancesCreated: result.committed?.balancesCreated ?? 0,
          policy,
        },
      });
    } else {
      await writeAuditLog({
        actorId: session.user.id,
        action: "employee.import_dryrun",
        targetTable: "users",
        targetId: null,
        metadata: {
          totalRows: result.totalRows,
          willInsert: result.willInsert,
          willUpdate: result.willUpdate,
          willSkip: result.willSkip,
          errors: result.errors,
          policy,
        },
      });
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error && err.message.includes("CSV content is required")) {
      return apiError(400, "EMPTY_CSV", "CSV content is required");
    }
    return handleRouteError(err);
  }
}
