use std::hash::{Hash, Hasher};

pub type Id = u64;

pub(crate) const FNV_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
pub(crate) const FNV_PRIME: u64 = 0x100000001b3;
pub(crate) const ROOT_SCOPE_ID: Id = FNV_OFFSET_BASIS;

pub(crate) fn hash_child_id<T: Hash>(parent: Id, key: T) -> Id {
    let mut hasher = FnvHasher { state: parent };
    key.hash(&mut hasher);
    hasher.finish()
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct FnvHasher {
    state: u64,
}

impl Hasher for FnvHasher {
    fn finish(&self) -> u64 {
        self.state
    }

    fn write(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.state ^= u64::from(*byte);
            self.state = self.state.wrapping_mul(FNV_PRIME);
        }
    }
}
