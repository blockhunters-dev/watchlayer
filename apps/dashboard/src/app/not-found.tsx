import Link from "next/link";
export default function NotFound() {
  return <section className="card" style={{ marginTop: 24 }}><h1 style={{ marginTop: 0 }}>Not found</h1><p className="muted">No such validator in the latest snapshot.</p><Link href="/validators">← All validators</Link></section>;
}
