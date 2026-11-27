// Changing any text here requires bumping PRIVACY_NOTICE_VERSION; page.test.tsx enforces it.
export function NoticeBody() {
  return (
    <>
      <p className="text-neutral-500">Effective 2026-11-27</p>
      <section>
        <h2 className="text-lg font-semibold">Who we are</h2>
        <p>
          Hush is the question-and-answer assistant of Hush Clinic, a fictional telehealth clinic
          for hair loss, weight and sexual health. It answers general questions from the
          clinic&apos;s own knowledge base. It is not medical advice and cannot diagnose or advise
          on doses.
        </p>
      </section>
      <section>
        <h2 className="text-lg font-semibold">What we collect</h2>
        <p>
          The messages you type into the chat, the answers you receive, and a record of your consent
          to this notice.
        </p>
      </section>
      <section>
        <h2 className="text-lg font-semibold">How we use it</h2>
        <p>
          We use your messages only to answer your questions from the clinic knowledge base. Before
          any text is sent to an external AI provider, personal details such as names, phone numbers
          and email addresses are removed.
        </p>
      </section>
      <section>
        <h2 className="text-lg font-semibold">Storage and retention</h2>
        <p>
          Your messages are encrypted when stored. They are kept for no longer than needed to answer
          and audit your questions; the exact period will be stated here before launch.
        </p>
      </section>
      <section>
        <h2 className="text-lg font-semibold">Your rights</h2>
        <p>
          You can ask to export your data, delete it, or withdraw your consent at any time by
          contacting privacy@hush.example (a self-serve page is coming).
        </p>
      </section>
      <section>
        <h2 className="text-lg font-semibold">Contact</h2>
        <p>Questions about this notice: privacy@hush.example (fictional address).</p>
      </section>
    </>
  );
}
