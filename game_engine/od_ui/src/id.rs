use std::hash::{Hash, Hasher};

use od_core::{FNV_OFFSET_BASIS, FnvHasher};

pub type Id = u64;

pub(crate) const ROOT_SCOPE_ID: Id = FNV_OFFSET_BASIS;

pub(crate) fn hash_child_id<T: Hash>(parent: Id, key: T) -> Id {
    let mut hasher = FnvHasher::with_offset(parent);
    key.hash(&mut hasher);
    hasher.finish()
}
