import { NextResponse } from "next/server";
import { absoluteUrl, siteHost } from "@/lib/site";

/**
 * did:web identity document. ARD's trust model is domain ownership — serving
 * this file from the domain itself IS the proof, which is the whole appeal
 * of did:web for a site this size. No signed trustManifest / SPIFFE
 * identities here on purpose; that's the enterprise-compliance layer this
 * prototype doesn't need to carry.
 */
export async function GET() {
  const host = siteHost();
  return NextResponse.json({
    "@context": ["https://www.w3.org/ns/did/v1"],
    id: `did:web:${host}`,
    alsoKnownAs: [absoluteUrl("/")],
  });
}
