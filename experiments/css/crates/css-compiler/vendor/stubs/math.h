#ifndef MATH_H
#define MATH_H
#define INFINITY (__builtin_inff())
#define NAN (__builtin_nanf(""))
#define signbit(x) (__builtin_signbit(x))
double pow(double, double);
double fmod(double, double);
double floor(double);
double ceil(double);
double round(double);
double log10(double);
#endif
