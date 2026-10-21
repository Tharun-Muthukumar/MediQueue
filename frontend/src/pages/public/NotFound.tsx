import { Logo, TokenStub } from '../../components/token';
import { ButtonLink } from '../../components/ui';

export default function NotFound() {
  return (
    <div className="min-h-screen px-5 py-6 sm:px-10">
      <Logo />
      <div className="mx-auto grid max-w-[880px] items-center gap-10 py-16 md:grid-cols-2">
        <div>
          <h1 className="text-[38px] font-bold leading-tight">This page isn't in the queue</h1>
          <p className="mt-3 text-[16px] text-ink-soft">The link may be old or mistyped. Head back and pick up where you left off.</p>
          <ButtonLink to="/home" className="mt-6" size="lg">Go to my dashboard</ButtonLink>
        </div>
        <TokenStub token="ERR-404" status="SKIPPED" caption="No page with this address." className="max-w-[300px]" />
      </div>
    </div>
  );
}
