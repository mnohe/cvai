import { readFileSync } from 'node:fs';
import { before, after, afterEach, test } from 'node:test';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-cvai',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });
});

after(async () => {
  await testEnv.cleanup();
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

// --- Own data access (must succeed) ---

test('owner can read own account profile', async () => {
  const db = testEnv.authenticatedContext('alice').firestore();
  await assertSucceeds(getDoc(doc(db, 'users', 'alice', 'account', 'profile')));
});

test('owner can write own account profile', async () => {
  const db = testEnv.authenticatedContext('alice').firestore();
  await assertSucceeds(
    setDoc(doc(db, 'users', 'alice', 'account', 'profile'), { uid: 'alice', displayName: 'Alice' }),
  );
});

test('owner can read own candidate profile', async () => {
  const db = testEnv.authenticatedContext('alice').firestore();
  await assertSucceeds(getDoc(doc(db, 'users', 'alice', 'candidate', 'profile')));
});

test('owner can write own candidate profile', async () => {
  const db = testEnv.authenticatedContext('alice').firestore();
  await assertSucceeds(
    setDoc(doc(db, 'users', 'alice', 'candidate', 'profile'), { name: 'Alice' }),
  );
});

test('candidate preferences length is limited to 2000 characters', async () => {
  const db = testEnv.authenticatedContext('alice').firestore();
  await assertSucceeds(
    setDoc(doc(db, 'users', 'alice', 'candidate', 'profile'), {
      preferences: 'x'.repeat(2000),
    }),
  );
  await assertFails(
    setDoc(doc(db, 'users', 'alice', 'candidate', 'profile'), {
      preferences: 'x'.repeat(2001),
    }),
  );
});

// --- Cross-user access (must fail) ---

test('authenticated user cannot read another user subtree', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', 'alice', 'account', 'profile'), {
      uid: 'alice',
    });
  });
  const db = testEnv.authenticatedContext('bob').firestore();
  await assertFails(getDoc(doc(db, 'users', 'alice', 'account', 'profile')));
});

test('authenticated user cannot write another user subtree', async () => {
  const db = testEnv.authenticatedContext('bob').firestore();
  await assertFails(
    setDoc(doc(db, 'users', 'alice', 'account', 'profile'), { uid: 'alice' }),
  );
});

// --- Unauthenticated access (must fail) ---

test('unauthenticated user is denied reading user data', async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'users', 'alice', 'account', 'profile')));
});

test('unauthenticated user is denied writing user data', async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(
    setDoc(doc(db, 'users', 'alice', 'account', 'profile'), { uid: 'alice' }),
  );
});

// --- Collections outside user subtree (must fail for all clients) ---

test('authenticated user cannot read _admin', async () => {
  const db = testEnv.authenticatedContext('alice').firestore();
  await assertFails(getDoc(doc(db, '_admin', 'settings')));
});

test('authenticated user cannot write _admin', async () => {
  const db = testEnv.authenticatedContext('alice').firestore();
  await assertFails(setDoc(doc(db, '_admin', 'settings'), { secret: 'data' }));
});

test('unauthenticated user cannot read _admin', async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, '_admin', 'settings')));
});

test('unauthenticated user cannot write _admin', async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(db, '_admin', 'settings'), { secret: 'data' }));
});
