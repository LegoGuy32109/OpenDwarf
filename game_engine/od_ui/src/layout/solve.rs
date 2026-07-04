use crate::{layout::Sizing, primitives::EPS};

#[derive(Clone, Copy, Debug)]
pub(crate) struct ResizableChild {
    pub(crate) size: f32,
    pub(crate) min: f32,
    pub(crate) max: f32,
    pub(crate) can_grow: bool,
}

impl ResizableChild {
    pub(crate) const fn can_grow(self) -> bool {
        self.can_grow
    }
}

pub(crate) fn clamp_size(value: f32, min: f32, max: f32) -> f32 {
    value.clamp(min.min(max), max.max(min))
}

pub(crate) fn sizing_bounds(sizing: Sizing) -> (f32, f32) {
    match sizing {
        Sizing::Fit { min, max } | Sizing::Grow { min, max } => (min, max),
        Sizing::Fixed(value) => (value, value),
        Sizing::Percent(_) => (0.0, f32::INFINITY),
    }
}

pub(crate) fn resolve_container_size(
    sizing: Sizing,
    parent_inner: f32,
    content: f32,
    fit_bias: f32,
) -> f32 {
    let (min, max) = sizing_bounds(sizing);
    let resolved = match sizing {
        Sizing::Fit { .. } => content,
        Sizing::Grow { .. } => parent_inner,
        Sizing::Fixed(value) => value,
        Sizing::Percent(fraction) => parent_inner * fraction,
    };
    clamp_size(resolved.max(fit_bias), min, max)
}

pub(crate) fn resolve_child_base_size(sizing: Sizing, content: f32) -> f32 {
    let (min, max) = sizing_bounds(sizing);
    let resolved = match sizing {
        Sizing::Fit { .. } => content,
        Sizing::Grow { .. } => min,
        Sizing::Fixed(value) => value,
        Sizing::Percent(_) => min,
    };
    clamp_size(resolved, min, max)
}

pub(crate) fn grow_children_smallest_first(children: &mut [ResizableChild], mut remaining: f32) {
    while remaining > EPS {
        let mut growable: Vec<usize> = children
            .iter()
            .enumerate()
            .filter(|(_, child)| child.can_grow() && child.size + EPS < child.max)
            .map(|(index, _)| index)
            .collect();
        if growable.is_empty() {
            break;
        }

        growable.sort_by(|left, right| {
            children[*left]
                .size
                .partial_cmp(&children[*right].size)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| left.cmp(right))
        });

        let smallest = children[growable[0]].size;
        let mut next_size = f32::INFINITY;
        let mut smallest_count = 0_usize;
        for index in growable.iter().copied() {
            let size = children[index].size;
            if (size - smallest).abs() <= EPS {
                smallest_count += 1;
            } else {
                next_size = size;
                break;
            }
        }

        let cap = growable
            .iter()
            .copied()
            .filter(|index| (children[*index].size - smallest).abs() <= EPS)
            .map(|index| children[index].max)
            .fold(next_size, f32::min);
        let headroom = (cap - smallest).max(0.0);
        if headroom <= EPS {
            for index in growable {
                if (children[index].size - smallest).abs() <= EPS
                    && children[index].size >= children[index].max - EPS
                {
                    children[index].can_grow = false;
                }
            }
            continue;
        }

        let step = (remaining / smallest_count as f32).min(headroom);
        for index in growable {
            if (children[index].size - smallest).abs() <= EPS {
                children[index].size += step;
                if children[index].size >= children[index].max - EPS {
                    children[index].size = children[index].max;
                }
            }
        }
        remaining -= step * smallest_count as f32;
    }
}

pub(crate) fn shrink_children_largest_first(children: &mut [ResizableChild], mut remaining: f32) {
    while remaining < -EPS {
        let mut shrinkable: Vec<usize> = children
            .iter()
            .enumerate()
            .filter(|(_, child)| child.size > child.min + EPS)
            .map(|(index, _)| index)
            .collect();
        if shrinkable.is_empty() {
            break;
        }

        shrinkable.sort_by(|left, right| {
            children[*right]
                .size
                .partial_cmp(&children[*left].size)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| left.cmp(right))
        });

        let largest = children[shrinkable[0]].size;
        let mut next_size = 0.0;
        let mut largest_count = 0_usize;
        for index in shrinkable.iter().copied() {
            let size = children[index].size;
            if (size - largest).abs() <= EPS {
                largest_count += 1;
            } else {
                next_size = size;
                break;
            }
        }

        let floor = shrinkable
            .iter()
            .copied()
            .filter(|index| (children[*index].size - largest).abs() <= EPS)
            .map(|index| children[index].min)
            .fold(next_size, f32::max);
        let headroom = (largest - floor).max(0.0);
        if headroom <= EPS {
            break;
        }

        let step = (-remaining / largest_count as f32).min(headroom);
        for index in shrinkable {
            if (children[index].size - largest).abs() <= EPS {
                children[index].size -= step;
                if children[index].size <= children[index].min + EPS {
                    children[index].size = children[index].min;
                }
            }
        }
        remaining += step * largest_count as f32;
    }
}
