import { createModel } from 'model-reaction';
export function createUsernameModel(availability: (name: string) => Promise<boolean>) {
  return createModel({ username: { type: 'string', default: 'guest', validator: [{
    type: 'availability', message: 'Username unavailable', validate: availability,
  }] } });
}
