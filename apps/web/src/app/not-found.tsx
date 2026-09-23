import { ButtonLink } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <div className="container page">
      <h1>Page not found</h1>
      <p className="muted">That page does not exist.</p>
      <div>
        <ButtonLink href="/play" variant="secondary">
          Go to Play
        </ButtonLink>
      </div>
    </div>
  );
}
