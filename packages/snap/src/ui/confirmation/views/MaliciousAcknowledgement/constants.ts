/**
 * Shared form element names for the malicious acknowledgement screen.
 *
 * The screen is reused across every scanned confirmation flow, so these names
 * live in one place and are handled by a single set of event handlers.
 */
export enum MaliciousAcknowledgementFormNames {
  Review = 'malicious-acknowledgement-review',
  Acknowledge = 'malicious-acknowledgement-checkbox',
  Proceed = 'malicious-acknowledgement-proceed',
  Back = 'malicious-acknowledgement-back',
}
