#pragma once
#include <cmath>
#include <cstdint>

namespace gh_audio {

// Blink's scheduled-source exclusive end frame. Input is the unrounded,
// absolute stop time in sample frames, after validation by the caller.
inline double exclusive_stop_frame(double absolute_stop_frame) {
    return std::ceil(std::round(absolute_stop_frame * 1024.0) / 1024.0);
}

class ExpSine {
public:
    // start_frame and end_frame are in the original AudioContext sample domain.
    // The caller supplies one next() per sample beginning at ceil(start_frame).
    bool reset(double sample_rate, double start_frame, double end_frame,
               double from_hz, double to_hz) {
        if (!std::isfinite(sample_rate) || !(sample_rate > 0) ||
            !std::isfinite(start_frame) || !std::isfinite(end_frame) ||
            start_frame < 0 || !(end_frame > start_frame) ||
            end_frame > 9007199254740991.0 ||
            !(from_hz > 0 && from_hz <= sample_rate / 2) ||
            !(to_hz > 0 && to_hz <= sample_rate / 2))
            return false;
        initial = static_cast<float>(from_hz);
        terminal = static_cast<float>(to_hz);
        if (!(initial > 0 && terminal > 0) ||
            !std::isfinite(initial) || !std::isfinite(terminal))
            return false;
        start = start_frame;
        end = end_frame;
        inverse_rate = 1 / sample_rate;
        cycles = 0;
        first = static_cast<int64_t>(std::ceil(start));
        slope = std::log(terminal / initial) / (end - start);
        // With no interior sample there is no consecutive step up the ramp.
        ratio = std::ceil(end) - first > 1 ? std::exp(slope) : 1;
        const int offset = static_cast<int>(first % 128);
        partial_left = offset ? 128 - offset : 0;
        // Blink writes at the onset offset but reads the a-rate phase increment
        // array from index zero on that first partial WebAudio quantum.
        automation_frame = first - offset;
        realign_frame = first + partial_left;
        frequency = offset ? initial : value_at(first);
        return true;
    }

    float next() {
        constexpr double tau = 6.283185307179586476925286766559;
        const float output = static_cast<float>(std::sin(tau * cycles));
        cycles += static_cast<float>(frequency) * inverse_rate;
        if (cycles >= 1) cycles -= 1;
        if (partial_left && --partial_left == 0) {
            automation_frame = realign_frame;
            frequency = value_at(automation_frame);
        } else {
            ++automation_frame;
            if (automation_frame >= end)
                frequency = terminal;
            else if (automation_frame == first)
                frequency = value_at(first);
            else if (automation_frame > first)
                frequency *= ratio;
        }
        return output;
    }

private:
    double value_at(int64_t frame) const {
        if (frame >= end) return terminal;
        if (frame <= start) return initial;
        return initial * std::exp((frame - start) * slope);
    }
    int64_t first{}, automation_frame{}, realign_frame{};
    int partial_left{};
    double start{}, end{}, initial{}, terminal{}, cycles{}, frequency{};
    double inverse_rate{}, slope{}, ratio{};
};
}  // namespace gh_audio
