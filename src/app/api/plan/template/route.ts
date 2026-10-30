import { NextRequest, NextResponse } from "next/server";
import { buildPlanTemplate } from "@/lib/excelPlan";

export async function GET(req: NextRequest) {
  const locale = req.nextUrl.searchParams.get("locale") === "en" ? "en" : "es";
  const buf = await buildPlanTemplate(locale);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="cadencia-plan-${locale}.xlsx"`,
    },
  });
}
