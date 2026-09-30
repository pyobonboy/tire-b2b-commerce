import Link from "next/link";
import { FileQuestion } from "lucide-react";

// Renders for both explicit notFound() calls and any URL that matches no
// route at all (see node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/not-found.md).
// Server Component by default, same as the docs' own example — there is no
// interactive state here, so no "use client" is needed.
export default function NotFound() {
  return (
    <div className="px-4 py-16 max-w-2xl mx-auto">
      <div className="card p-8 text-center">
        <FileQuestion className="mx-auto text-muted" size={40} />
        <h1 className="mt-4 text-xl font-extrabold">페이지를 찾을 수 없습니다</h1>
        <p className="mt-3 text-sm text-muted">
          요청하신 페이지가 삭제되었거나 주소가 변경되었을 수 있습니다.
        </p>
        <Link href="/" className="btn-primary mt-6 inline-flex h-11 items-center px-5">
          홈으로 가기
        </Link>
      </div>
    </div>
  );
}
