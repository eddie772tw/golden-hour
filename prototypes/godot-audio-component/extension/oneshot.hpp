#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <span>

namespace gh_audio {

// Forward, non-looping AudioBufferSource with constant playbackRate and zero detune.
// Inputs are planar immutable PCM. Time arguments other than offset_seconds use mix frames.
struct OneShot {
    bool init(std::span<const float> left, std::span<const float> right,
              double source_rate, double mix_rate, double start_frame,
              double offset_seconds, double playback_rate) {
        left_ = {};
        if (left.empty() || (!right.empty() && right.size() != left.size()) ||
            !std::isfinite(source_rate) || source_rate <= 0 ||
            !std::isfinite(mix_rate) || mix_rate <= 0 ||
            !std::isfinite(start_frame) || start_frame < 0 ||
            !std::isfinite(offset_seconds) || offset_seconds < 0 ||
            !std::isfinite(playback_rate) || playback_rate <= 0) return false;
        const float param_rate = static_cast<float>(playback_rate);
        const double step = (source_rate / mix_rate) * param_rate;
        if (!std::isfinite(step) || step <= 0 || step > 1024 || step > left.size()) return false;
        left_ = left;
        right_ = right;
        start_ = start_frame;
        const double initial = std::min(offset_seconds * source_rate, double(left.size()));
        offset_ = param_rate == 1.0f ? std::round(initial) : initial;
        step_ = step;
        stop_ = std::numeric_limits<double>::infinity();
        return true;
    }

    // The caller replaces a scheduled stop only while this source is still live.
    void stop(double frame) { stop_ = frame; }

    bool sample(int64_t frame, float &left, float &right) const {
        left = right = 0;
        if (left_.empty() || frame < start_ || frame >= stop_) return false;
        const double position = offset_ + (frame - start_) * step_;
        if (position >= left_.size()) return false;
        const auto index = static_cast<size_t>(position);
        const double fraction = position - double(index);
        left = interpolate(left_, index, fraction);
        right = right_.empty() ? left : interpolate(right_, index, fraction);
        return true;
    }

private:
    std::span<const float> left_, right_;
    double start_{}, offset_{}, step_{}, stop_{};

    static float interpolate(std::span<const float> pcm, size_t i, double t) {
        const double a = pcm[i];
        if (i + 1 < pcm.size())
            return static_cast<float>((1.0 - t) * a + t * pcm[i + 1]);
        // Blink extrapolates the fractional final sample until the playhead exits.
        if (i) return static_cast<float>(a + (a - pcm[i - 1]) * t);
        return static_cast<float>(a);
    }
};
}
