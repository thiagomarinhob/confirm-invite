export type MemberStatus = 'pending' | 'yes' | 'no';

export interface Member {
  id: string;
  name: string;
  status: MemberStatus;
}

export interface Family {
  id: string;
  slug: string;
  name: string;
  responsible: string;
  respondedAt?: string | null;
  /** Recado deixado na última confirmação pelo link público */
  rsvpNote?: string;
  members: Member[];
}

export interface Settings {
  eventTitle: string;
  eventDate: string;
  organizerEmail: string;
}

export interface PublicFamilyPayload {
  eventTitle: string;
  eventDate: string;
  organizerEmail: string;
  family: { slug: string; name: string; responsible: string };
  members: Member[];
}
