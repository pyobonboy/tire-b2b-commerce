"use client";

import { useParams } from "next/navigation";
import SellerListingForm from "@/components/SellerListingForm";

export default function EditSellerListingPage() {
  const params = useParams<{ id: string }>();
  return <SellerListingForm listingId={params.id} />;
}
